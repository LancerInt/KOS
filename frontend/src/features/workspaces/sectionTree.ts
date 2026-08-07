/**
 * The section tree for a project.
 *
 * Sections come from two places: the built-in ones declared in `workspaces.tsx`,
 * and the rows in the database. A built-in has no row until someone customises
 * it ("adoption"), so identity cannot simply be the row id.
 *
 * The rule that makes nesting work: **a database row participates in built-in
 * name-matching only when it is top-level** (`parent === null`). A built-in's
 * identity has always been its name at root level, and scoping the match to root
 * is what lets two sub-sections in different branches share a name — the old
 * flat `Map<lowercased name, row>` could not tell them apart.
 *
 * A node's key is therefore stable across adoption: `b:product` before and after
 * a row exists for it, so nothing remounts mid-save.
 */
import type { FieldDef } from "./fields";
import { stringsToFields, toFieldDefs } from "./fields";
import type { WorkspaceSection } from "./sectionsApi";
import type { WorkspaceRecord } from "./recordsApi";
import type { WorkspaceCategory } from "./workspaces";

export type NodeKey = string;

const norm = (s: string) => s.trim().toLowerCase();

/** Key for a built-in section, whether or not it has been adopted. */
export const builtinKey = (name: string): NodeKey => `b:${norm(name)}`;

export interface SectionNode {
  key: NodeKey;
  /** Row id, or null for a built-in nobody has customised yet. */
  id: number | null;
  parent: SectionNode | null;
  name: string;
  blurb: string;
  fieldDefs: FieldDef[];
  allowFiles: boolean;
  isBuiltin: boolean;
  /** This node's own hidden flag — what a restore chip acts on. */
  selfHidden: boolean;
  depth: number;
  children: SectionNode[];
  /** Deleted children, offered as restore chips at this level. */
  hiddenChildren: SectionNode[];
  /** Records directly in this section. */
  ownCount: number;
  /** ownCount plus every visible descendant's. */
  totalCount: number;
}

export interface SectionTree {
  roots: SectionNode[];
  hiddenRoots: SectionNode[];
  byKey: Map<NodeKey, SectionNode>;
}

export function buildSectionTree(
  builtins: WorkspaceCategory[],
  rows: WorkspaceSection[],
  records: WorkspaceRecord[],
): SectionTree {
  const builtinNames = new Set(builtins.map((c) => norm(c.name)));

  // 1 — record counts. Two indexes: records written before sections had a FK,
  // and records on an unadopted built-in, carry only a name.
  const cntById = new Map<number, number>();
  const cntByName = new Map<string, number>();
  for (const r of records) {
    if (r.section != null) cntById.set(r.section, (cntById.get(r.section) ?? 0) + 1);
    else cntByName.set(norm(r.category), (cntByName.get(norm(r.category)) ?? 0) + 1);
  }

  // 2 — key every row. Only a ROOT row may claim a built-in's identity.
  const keyOf = (row: WorkspaceSection): NodeKey =>
    row.parent == null && builtinNames.has(norm(row.name)) ? builtinKey(row.name) : String(row.id);

  const keyById = new Map<number, NodeKey>();
  const adopting = new Map<NodeKey, WorkspaceSection>();
  for (const row of rows) {
    const k = keyOf(row);
    keyById.set(row.id, k);
    if (k.startsWith("b:")) adopting.set(k, row);
  }

  // 3 — one node per built-in (merged with its adopting row), then one per
  // remaining row. Insertion order keeps built-ins in config order followed by
  // custom sections in creation order, exactly as the flat grid did.
  const byKey = new Map<NodeKey, SectionNode>();
  const mk = (p: Partial<SectionNode> & Pick<SectionNode, "key">): SectionNode => ({
    id: null, parent: null, name: "", blurb: "", fieldDefs: [], allowFiles: false,
    isBuiltin: false, selfHidden: false, depth: 0, children: [], hiddenChildren: [],
    ownCount: 0, totalCount: 0, ...p,
  });
  const parentKeyOf = new Map<NodeKey, NodeKey | null>();

  for (const c of builtins) {
    const k = builtinKey(c.name);
    const row = adopting.get(k);
    const saved = row ? toFieldDefs(row.fields) : [];
    byKey.set(k, mk({
      key: k,
      id: row?.id ?? null,
      name: c.name,                                   // config casing always wins
      blurb: row?.blurb || c.blurb,
      fieldDefs: saved.length ? saved : stringsToFields(c.fields),
      allowFiles: !!c.allowFiles,
      isBuiltin: true,
      selfHidden: !!row?.hidden,
      ownCount: (row ? cntById.get(row.id) ?? 0 : 0) + (cntByName.get(norm(c.name)) ?? 0),
    }));
    parentKeyOf.set(k, null);
  }

  for (const row of rows) {
    const k = keyOf(row);
    if (byKey.has(k)) continue;                       // the adopting row, already merged
    const saved = toFieldDefs(row.fields);
    byKey.set(k, mk({
      key: k,
      id: row.id,
      name: row.name,
      blurb: row.blurb || "Custom section.",
      fieldDefs: saved.length ? saved : stringsToFields(["Description"]),
      selfHidden: !!row.hidden,
      // The name fallback is root-only. This is the fix for two sub-sections
      // sharing a name: a record with no FK can only belong to a root node.
      ownCount: (cntById.get(row.id) ?? 0)
        + (row.parent == null ? cntByName.get(norm(row.name)) ?? 0 : 0),
    }));
    parentKeyOf.set(k, row.parent != null ? keyById.get(row.parent) ?? null : null);
  }

  // 4 — link. An unresolvable parent re-homes at root rather than vanishing.
  for (const n of byKey.values()) {
    const pk = parentKeyOf.get(n.key) ?? null;
    const p = pk != null ? byKey.get(pk) : undefined;
    n.parent = p ?? null;
  }

  // 5 — bucket children onto their parent, splitting visible from deleted.
  const roots: SectionNode[] = [];
  const hiddenRoots: SectionNode[] = [];
  for (const n of byKey.values()) {
    const into = n.parent
      ? (n.selfHidden ? n.parent.hiddenChildren : n.parent.children)
      : (n.selfHidden ? hiddenRoots : roots);
    into.push(n);
  }

  // 6 — walk down from the roots for depth and rolled-up counts. Any node caught
  // in a parent cycle is unreachable from a root and is simply dropped, so
  // corrupt data cannot spin the render forever.
  const visit = (n: SectionNode, depth: number): number => {
    n.depth = depth;
    n.totalCount = n.ownCount + n.children.reduce((s, c) => s + visit(c, depth + 1), 0);
    n.hiddenChildren.forEach((c) => visit(c, depth + 1));   // not rolled into the total
    return n.totalCount;
  };
  roots.forEach((r) => visit(r, 0));
  hiddenRoots.forEach((r) => visit(r, 0));

  return { roots, hiddenRoots, byKey };
}

/** Root → … → node, for a breadcrumb. Hop-capped against a corrupt chain. */
export function ancestorTrail(node: SectionNode | null): SectionNode[] {
  const out: SectionNode[] = [];
  for (let n = node, hops = 0; n && hops < 64; n = n.parent, hops++) out.unshift(n);
  return out;
}

/** Does this record live *directly* in this node? Replaces the old
 *  `r.category === selected.name` comparison, which collided across branches. */
export const recordIn = (r: WorkspaceRecord, n: SectionNode): boolean =>
  r.section != null ? r.section === n.id : n.parent == null && norm(r.category) === norm(n.name);
