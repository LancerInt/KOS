import { useEffect, useReducer } from "react";
import type { SvgIconComponent } from "@mui/icons-material";
import type { FieldDef } from "./fields";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import CelebrationRoundedIcon from "@mui/icons-material/CelebrationRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import ShareRoundedIcon from "@mui/icons-material/ShareRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import BugReportRoundedIcon from "@mui/icons-material/BugReportRounded";
import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import WorkRoundedIcon from "@mui/icons-material/WorkRounded";
import RocketLaunchRoundedIcon from "@mui/icons-material/RocketLaunchRounded";
import ShoppingCartRoundedIcon from "@mui/icons-material/ShoppingCartRounded";
import { listWorkspaces, type DynamicWorkspace } from "./workspacesApi";
import { registerDynamicAccents } from "./accent";

/**
 * The operational workspaces shown in the sidebar. These are navigation
 * sections for the company's real areas of work; each opens a landing page
 * that lists its sub-sections. They are placeholders for now — no backend data
 * is wired behind them yet.
 */
/** A clickable category within a workspace — opens a detail panel that lists
 *  the fields it will track. Currently used by Amazon USA only. */
export interface WorkspaceCategory {
  name: string;
  blurb: string;
  fields: string[];
  /** Typed field schema. When present it overrides `fields` for the builder and
   *  record form; merged in at runtime from the section's saved schema. */
  fieldDefs?: FieldDef[];
  /** Built-in sub-sections. A child is a section in every respect — its own
   *  fields, records and delete/restore — so a workflow's steps or a team's
   *  members can be modelled as structure rather than flattened into labels. */
  children?: WorkspaceCategory[];
  /** Allow attaching a file (document / poster / PPT) when adding a record. */
  allowFiles?: boolean;
  /** Set once a section has a WorkspaceSection row (custom, or a built-in whose
   *  fields were customised) — the id used to save the schema or delete it. */
  sectionId?: number;
  /** True for user-created sections (hard-deleted); false for built-in ones
   *  (delete = hidden per project). */
  isCustom?: boolean;
  /** Built-in section hidden for this project via a hidden section row. */
  hidden?: boolean;
}

export interface Workspace {
  key: string;
  label: string;
  Icon: SvgIconComponent;
  blurb: string;
  sections: string[];
  /** When present, the workspace renders these as clickable cards with a field
   *  detail drawer, instead of the plain placeholder sections. */
  categories?: WorkspaceCategory[];
  /** Hex accent for user-added workspaces (built-ins use accent.ts). */
  accent?: string;
  /** True for user-added (DB) workspaces — archivable; the 11 built-ins aren't. */
  dynamic?: boolean;
}

export const WORKSPACES: Workspace[] = [
  {
    key: "amazon-usa",
    label: "Amazon USA",
    Icon: StorefrontRoundedIcon,
    blurb: "Selling on the Amazon US marketplace.",
    // The sections follow the order a product is actually taken to market on
    // Amazon US — decide the product, secure the brand, clear regulation, then
    // package, list, launch and monitor. They are steps, not a catalogue, so a
    // project reads top-to-bottom as the work still to do.
    sections: [
      "Finalize the Product", "Select and Register the Brand Name",
      "Prepare the Formula and Manufacturing Documents", "EPA Registration (if required)",
      "Finalize Packaging", "Design Product Label, Leaflet and Packaging",
      "Complete Legal Requirements", "Register as an Amazon USA Seller",
      "Create Product Listings", "Benchmark Competitors", "Launch the Product",
      "Monitor Performance",
    ],
    categories: [
      {
        name: "Finalize the Product",
        blurb: "What the product is, settled before anything downstream is committed.",
        fields: ["Product category", "Composition/formulation", "Product specifications"],
      },
      {
        name: "Select and Register the Brand Name",
        blurb: "Choosing a brand name and securing the right to use it.",
        fields: ["Brand availability check", "Trademark application (recommended)"],
      },
      {
        name: "Prepare the Formula and Manufacturing Documents",
        blurb: "The formulation and the paperwork manufacturing and registration depend on.",
        fields: ["Composition", "Manufacturing process/recipe", "COA", "SDS and other documents (if applicable)"],
      },
      {
        name: "EPA Registration (if required)",
        blurb: "Whether the product needs EPA registration, and clearing it before sale.",
        fields: ["Determine whether the product requires EPA registration", "Obtain EPA approval before sale (for applicable pesticide products)"],
      },
      {
        name: "Finalize Packaging",
        blurb: "Container, materials and carton specification.",
        fields: ["Bottle/container type", "Packaging material", "Carton specifications"],
      },
      {
        name: "Design Product Label, Leaflet and Packaging",
        blurb: "Artwork for the label, leaflet and pack, through to final approval.",
        fields: ["EPA-compliant label (if applicable)", "Product leaflet/instructions", "Final artwork approval"],
      },
      {
        name: "Complete Legal Requirements",
        blurb: "The US business, banking and tax paperwork needed to trade.",
        fields: ["USA business registration (if required)", "USA bank account", "Tax information and other legal documents"],
      },
      {
        name: "Register as an Amazon USA Seller",
        blurb: "Getting a Seller Central account open, verified and able to be paid.",
        fields: ["Create Amazon Seller Central account", "Complete identity verification", "Set up payment and tax details"],
      },
      {
        name: "Create Product Listings",
        blurb: "The listing content that goes live on the marketplace.",
        fields: ["Product title", "Images", "Bullet points", "Description", "Keywords"],
      },
      {
        name: "Benchmark Competitors",
        blurb: "What comparable products do, at what price, and how they are received.",
        fields: ["Review similar products", "Analyse pricing", "Study competitors listings and customer reviews"],
      },
      {
        name: "Launch the Product",
        blurb: "Inventory in, listing live, promotion running.",
        fields: ["Upload inventory", "Activate listing", "Start advertising and promotions"],
      },
      {
        name: "Monitor Performance",
        blurb: "How the product does once it is selling.",
        fields: ["Customer reviews", "Order management", "Returns and cancellations", "Finance and accounting", "Inventory management"],
      },
    ],
  },
  {
    key: "cibrc",
    label: "CIBRC Registration",
    Icon: GavelRoundedIcon,
    blurb: "India CIB&RC product registrations.",
    sections: ["Product category", "Label", "Leaflet", "Documentation", "Renewals"],
    categories: [
      { name: "Product category", blurb: "Product categories registered with CIB&RC.", fields: ["Description"] },
      { name: "Label", blurb: "Approved product labels.", fields: ["Description"] },
      { name: "Leaflet", blurb: "Product leaflets and inserts.", fields: ["Description"] },
      { name: "Documentation", blurb: "Supporting documents and dossiers.", fields: ["Description"] },
      { name: "Renewals", blurb: "Registration renewals and timelines.", fields: ["Description"] },
    ],
  },
  {
    key: "epa-reg",
    label: "EPA Reg",
    Icon: PublicRoundedIcon,
    blurb: "US EPA product registrations.",
    sections: ["New registrations", "Renewals", "Data-package submissions", "Label amendments", "State (24c / SLN)", "EPA correspondence"],
    categories: [
      { name: "New registrations", blurb: "New product registrations filed with the US EPA.", fields: ["Description"] },
      { name: "Renewals", blurb: "Renewing existing EPA registrations before they expire.", fields: ["Description"] },
      { name: "Data-package submissions", blurb: "Study data packages submitted to the EPA.", fields: ["Description"] },
      { name: "Label amendments", blurb: "Changes to approved product labels.", fields: ["Description"] },
      { name: "State (24c / SLN)", blurb: "State-level special local-need registrations.", fields: ["Description"] },
      { name: "EPA correspondence", blurb: "Letters and communications with the EPA.", fields: ["Description"] },
    ],
  },
  {
    key: "marketing-marathon",
    label: "Marketing Marathon",
    Icon: CampaignRoundedIcon,
    blurb: "The Marketing Marathon campaign.",
    // The expo lead-nurture process: where leads came from, who they are, and
    // what happened to each one — then the sprints that work the backlog, and
    // the monthly numbers. The generic campaign sections follow it.
    sections: [
      "Expo details", "Client database", "Follow-up tracker", "Response tracker",
      "Lost opportunities tracker", "Next expo invitation tracker",
      "Agile workflow", "Track every month",
      "Campaign plan", "Content calendar", "Creatives & assets", "Email campaigns",
      "Performance tracking",
    ],
    categories: [
      {
        name: "Expo details",
        blurb: "Each expo attended and what it brought in — one record per expo.",
        fields: ["Year", "Expo Name", "Country", "Total Leads"],
      },
      {
        name: "Client database",
        blurb: "Everyone met, and which expo they came from — one record per client.",
        fields: ["Client Name", "Company", "Country", "Email", "Phone", "Product Interest", "Expo Year"],
      },
      {
        name: "Follow-up tracker",
        blurb: "Where each client stands in the follow-up sequence.",
        fields: ["Client", "Country", "First Email", "Second Follow-up", "Last Contact", "Status"],
      },
      {
        name: "Response tracker",
        blurb: "Positive responses, by what the client actually asked for.",
        fields: ["Requested quotation", "Requested samples", "Distributor interest", "Registration support"],
      },
      {
        name: "Lost opportunities tracker",
        blurb: "Clients whose communication stopped, and why.",
        fields: ["Client", "Country", "Last Communication", "Reason"],
      },
      {
        name: "Next expo invitation tracker",
        blurb: "Invitations to the next expo, counted country by country.",
        fields: ["Country", "Total Clients", "Invited", "Accepted", "Rejected", "No Response"],
      },
      {
        name: "Agile workflow",
        blurb: "The backlog worked through in sprints, oldest cards first.",
        fields: ["Description"],
        children: [
          {
            name: "Backlog",
            blurb: "Everything not yet worked, in one pile.",
            fields: ["Collect all visiting cards from the last 5–6 years"],
          },
          {
            name: "Sprint 1",
            blurb: "Turning the card pile into data.",
            fields: ["Convert visiting cards into Excel"],
          },
          {
            name: "Sprint 2",
            blurb: "Grouping the data so it can be worked by region.",
            fields: ["Categorize clients country-wise"],
          },
          {
            name: "Sprint 3",
            blurb: "Reading what came back, and what didn't.",
            fields: ["Analyze responses and non-responses"],
          },
          {
            name: "Sprint 4",
            blurb: "Putting the list to work on the next expo.",
            fields: ["Invite clients to upcoming expos"],
          },
          {
            name: "Sprint 5",
            blurb: "Going back to the ones who went quiet.",
            fields: ["Reconnect with inactive clients"],
          },
          {
            name: "Sprint 6",
            blurb: "Making the cycle measurable.",
            fields: ["Generate monthly reports"],
          },
        ],
      },
      {
        name: "Track every month",
        blurb: "The monthly numbers — one record per month.",
        fields: ["Total clients contacted", "Country-wise inquiries", "Response rate", "No-response rate", "Number of quotations sent", "Number of samples sent", "Number of converted clients", "Lost clients and reasons"],
      },
      { name: "Campaign plan", blurb: "Overall plan, goals and timeline for the campaign.", fields: ["Description"] },
      { name: "Content calendar", blurb: "Scheduled content across channels.", fields: ["Description"] },
      { name: "Creatives & assets", blurb: "Design assets, graphics and copy.", fields: ["Description"] },
      { name: "Email campaigns", blurb: "Email marketing sends and sequences.", fields: ["Description"] },
      { name: "Performance tracking", blurb: "Metrics and results of the campaign.", fields: ["Description"] },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    Icon: HandshakeRoundedIcon,
    blurb: "Leads, opportunities and customers.",
    sections: ["Leads", "Opportunities", "Customers", "Follow-ups", "Quotations"],
    categories: [
      { name: "Leads", blurb: "Incoming leads and enquiries.", fields: ["Description"] },
      { name: "Opportunities", blurb: "Active sales opportunities in the pipeline.", fields: ["Description"] },
      { name: "Customers", blurb: "Existing customer accounts.", fields: ["Description"] },
      { name: "Follow-ups", blurb: "Scheduled follow-up actions.", fields: ["Description"] },
      { name: "Quotations", blurb: "Quotes issued to customers.", fields: ["Description"] },
    ],
  },
  {
    key: "exhibition-b2c",
    label: "Exhibition & Marketing B2C",
    Icon: CelebrationRoundedIcon,
    blurb: "Trade shows and consumer marketing.",
    sections: ["Event calendar", "Booth & logistics", "Collaterals & samples", "Leads captured", "Post-event follow-up"],
    categories: [
      { name: "Event calendar", blurb: "Upcoming trade shows and events.", fields: ["Description"] },
      { name: "Booth & logistics", blurb: "Booth setup and event logistics.", fields: ["Description"] },
      { name: "Collaterals & samples", blurb: "Brochures, samples and giveaways.", fields: ["Description"] },
      { name: "Leads captured", blurb: "Leads collected at events.", fields: ["Description"] },
      { name: "Post-event follow-up", blurb: "Follow-up actions after each event.", fields: ["Description"] },
    ],
  },
  {
    key: "distribution-us",
    label: "Distribution US",
    Icon: LocalShippingRoundedIcon,
    blurb: "US distribution and fulfillment.",
    sections: ["Distributor onboarding", "Orders & fulfillment", "Inventory & warehousing", "Shipping & logistics", "Pricing & agreements"],
    categories: [
      { name: "Distributor onboarding", blurb: "Bringing new distributors on board.", fields: ["Description"] },
      { name: "Orders & fulfillment", blurb: "Customer orders and their fulfillment.", fields: ["Description"] },
      { name: "Inventory & warehousing", blurb: "Stock levels and warehouse management.", fields: ["Description"] },
      { name: "Shipping & logistics", blurb: "Shipping, carriers and logistics.", fields: ["Description"] },
      { name: "Pricing & agreements", blurb: "Distributor pricing and contracts.", fields: ["Description"] },
    ],
  },
  {
    key: "social-media",
    label: "Social Media",
    Icon: ShareRoundedIcon,
    blurb: "Social channels and content.",
    // The content-operations model first — what to say, when to post it, who
    // does which part — then the per-channel sections for the work itself.
    // Two of these are two-level: a workflow's steps and a team's members are
    // each a section in their own right, with their own fields and records.
    sections: [
      "Product Insight", "Create a content calendar", "Content creation workflow",
      "Track performance every month", "Team structure (4 members)", "Monthly workflow",
      "WhatsApp", "LinkedIn", "Instagram", "Facebook", "YouTube", "X (Twitter)",
    ],
    categories: [
      {
        name: "Product Insight",
        blurb: "What there is to say about the product, and why it matters to a buyer.",
        fields: ["Features", "Advantages/ Benefits"],
      },
      {
        // A table in the source document: one record per platform, so the
        // cadence can change per platform without editing the schema.
        name: "Create a content calendar",
        blurb: "Posting cadence per platform — add one record for each channel.",
        fields: ["Platform", "Posts per week"],
      },
      {
        name: "Content creation workflow",
        blurb: "The weekly cycle from planning through to publishing.",
        fields: ["Description"],
        children: [
          {
            name: "Step 1: Planning (Monday)",
            blurb: "Deciding what the week will say.",
            fields: ["Decide weekly topics", "Collect images and videos", "Prepare captions"],
          },
          {
            name: "Step 2: Design (Tuesday)",
            blurb: "Turning the plan into artwork.",
            fields: ["Create posters in Canva/chatgpt/gemini", "Add company logo", "Add product details"],
          },
          {
            name: "Step 3: Approval (Wednesday)",
            blurb: "Checking it before it goes anywhere.",
            fields: ["Review content", "Check grammar", "Verify technical data"],
          },
          {
            name: "Step 4: Schedule (Thursday)",
            blurb: "Queueing the week's posts.",
            fields: ["Schedule posts", "Add hashtags"],
          },
          {
            name: "Step 5: Publish (Friday onwards)",
            blurb: "Going live, and staying with it afterwards.",
            fields: ["Upload content", "Respond to comments", "Reply to messages"],
          },
        ],
      },
      {
        name: "Track performance every month",
        blurb: "The monthly numbers — one record per month.",
        fields: ["Reach", "Likes", "Comments", "Shares", "Website clicks", "Leads generated", "Export inquiries"],
      },
      {
        name: "Team structure (4 members)",
        blurb: "Who owns what.",
        fields: ["Description"],
        children: [
          {
            name: "Member 1 (You): Marketing Responsible",
            blurb: "Direction, measurement and sign-off.",
            fields: ["Strategy", "Analytics", "Approval"],
          },
          {
            name: "Member 2: Content Executive",
            blurb: "The words.",
            fields: ["Captions", "Blog posts", "Hashtags", "Product descriptions"],
          },
          {
            name: "Member 3: Designer",
            blurb: "The visuals.",
            fields: ["Posters", "Videos"],
          },
          {
            name: "Member 4: Community Manager",
            blurb: "Everything that happens after a post goes live.",
            fields: ["Reply to comments", "Handle inquiries", "Follow up with leads", "Schedule posts"],
          },
        ],
      },
      {
        name: "Monthly workflow",
        blurb: "What each week of the month is for.",
        fields: ["Week 1: Planning", "Week 2: Content creation", "Week 3: Promotion and ads", "Week 4: Analytics and improvements"],
      },
      { name: "WhatsApp", blurb: "WhatsApp channel activity and content.", fields: ["Description"] },
      { name: "LinkedIn", blurb: "LinkedIn posts and engagement.", fields: ["Description"] },
      { name: "Instagram", blurb: "Instagram content and campaigns.", fields: ["Description"] },
      { name: "Facebook", blurb: "Facebook page posts and ads.", fields: ["Description"] },
      { name: "YouTube", blurb: "YouTube videos and channel.", fields: ["Description"] },
      { name: "X (Twitter)", blurb: "Posts and engagement on X.", fields: ["Description"] },
    ],
  },
  {
    key: "website-biodesk",
    label: "Website & Biodesk",
    Icon: LanguageRoundedIcon,
    blurb: "Marketing site and the Biodesk app.",
    sections: ["Website content", "Blog & SEO", "Product pages", "Biodesk app", "Analytics"],
    categories: [
      { name: "Website content", blurb: "Pages and content on the website.", fields: ["Description"] },
      { name: "Blog & SEO", blurb: "Blog articles and search optimisation.", fields: ["Description"] },
      { name: "Product pages", blurb: "Product listing pages.", fields: ["Description"] },
      { name: "Biodesk app", blurb: "The Biodesk application.", fields: ["Description"] },
      { name: "Analytics", blurb: "Website and app traffic analytics.", fields: ["Description"] },
    ],
  },
  {
    key: "entomology",
    label: "Entomology",
    Icon: BugReportRoundedIcon,
    blurb: "Insect research and product efficacy.",
    sections: [
      "Insect Culture Maintenance", "Bioproduct Preparation", "Laboratory Bioassays",
      "Field Bioefficacy Trials", "Pest Mortality Assessment", "Dose–Response Evaluation",
      "Crop Damage Assessment", "Residual Activity Assessment", "Non-Target Effects",
      "Statistical Data Analysis",
    ],
    categories: [
      { name: "Insect Culture Maintenance", blurb: "Rearing and maintaining insect colonies.", fields: ["Duration", "Description"] },
      { name: "Bioproduct Preparation", blurb: "Preparing bioproduct formulations.", fields: ["Duration", "Description"] },
      { name: "Laboratory Bioassays", blurb: "Controlled lab efficacy assays.", fields: ["Duration", "Description"] },
      { name: "Field Bioefficacy Trials", blurb: "Field trials of product efficacy.", fields: ["Duration", "Description"] },
      { name: "Pest Mortality Assessment", blurb: "Measuring pest mortality.", fields: ["Duration", "Description"] },
      { name: "Dose–Response Evaluation", blurb: "Dose–response relationships.", fields: ["Duration", "Description"] },
      { name: "Crop Damage Assessment", blurb: "Assessing crop damage.", fields: ["Duration", "Description"] },
      { name: "Residual Activity Assessment", blurb: "Residual activity over time.", fields: ["Duration", "Description"] },
      { name: "Non-Target Effects", blurb: "Effects on non-target organisms.", fields: ["Duration", "Description"] },
      { name: "Statistical Data Analysis", blurb: "Statistical analysis and reporting — attach documents, posters or PPTs.", fields: ["Duration", "Description"], allowFiles: true },
    ],
  },
  {
    key: "finance-statutory",
    label: "Finance & Statutory",
    Icon: AccountBalanceRoundedIcon,
    blurb: "Finance and statutory compliance.",
    sections: ["Invoicing (AR)", "Payments (AP)", "Budgets", "Statutory filings", "Reports"],
    categories: [
      { name: "Invoicing (AR)", blurb: "Customer invoices and receivables.", fields: ["Description"] },
      { name: "Payments (AP)", blurb: "Supplier payments and payables.", fields: ["Description"] },
      { name: "Budgets", blurb: "Budgets and forecasts.", fields: ["Description"] },
      { name: "Statutory filings", blurb: "Statutory and compliance filings.", fields: ["Description"] },
      { name: "Reports", blurb: "Financial reports and statements.", fields: ["Description"] },
    ],
  },
];

// Icons a new workspace can pick from (name → component). Names are stored on
// the Workspace row; the picker in NewWorkspaceDialog shows these.
export const ICON_REGISTRY: Record<string, SvgIconComponent> = {
  folder: FolderRoundedIcon,
  storefront: StorefrontRoundedIcon,
  "shopping-cart": ShoppingCartRoundedIcon,
  gavel: GavelRoundedIcon,
  public: PublicRoundedIcon,
  campaign: CampaignRoundedIcon,
  handshake: HandshakeRoundedIcon,
  celebration: CelebrationRoundedIcon,
  "local-shipping": LocalShippingRoundedIcon,
  share: ShareRoundedIcon,
  language: LanguageRoundedIcon,
  "bug-report": BugReportRoundedIcon,
  "account-balance": AccountBalanceRoundedIcon,
  science: ScienceRoundedIcon,
  inventory: Inventory2RoundedIcon,
  support: SupportAgentRoundedIcon,
  insights: InsightsRoundedIcon,
  group: GroupsRoundedIcon,
  work: WorkRoundedIcon,
  rocket: RocketLaunchRoundedIcon,
};
export const ICON_OPTIONS = Object.keys(ICON_REGISTRY);

/** The registry name behind a workspace's icon component. Editing a workspace
 *  sends the icon back by name, and a built-in only holds the component — every
 *  built-in icon is registered above, so the lookup resolves. */
export const iconNameOf = (w: Workspace): string =>
  ICON_OPTIONS.find((name) => ICON_REGISTRY[name] === w.Icon) ?? "folder";

/** Accent swatches offered when creating a workspace. */
export const ACCENT_OPTIONS = [
  "#0F7A8B", "#C07A1E", "#2E8B6B", "#C0417A", "#7C5CD6",
  "#2E7DE0", "#4A6572", "#B08A24", "#C15B8A", "#5B8C3E",
];

// ---- Dynamic (user-added) workspaces --------------------------------------
// Loaded from the API once and cached in-module so getWorkspace stays sync.

function fromDynamic(w: DynamicWorkspace): Workspace {
  return {
    key: w.key,
    label: w.label,
    blurb: w.blurb,
    Icon: ICON_REGISTRY[w.icon] ?? FolderRoundedIcon,
    sections: [],
    categories: [],            // starts empty — sections are built per project
    accent: w.accent || undefined,
    dynamic: true,
  };
}

let dynamicCache: Workspace[] = [];
/** Customised labels/descriptions for *built-in* workspaces, by key. A built-in
 *  has no row until someone renames it; from then on the row's label wins while
 *  the sections and icon keep coming from config. */
let builtinOverrides = new Map<string, Pick<Workspace, "label" | "blurb">>();
let dynamicLoaded = false;
let dynamicLoading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function allWorkspaces(): Workspace[] {
  // Overrides patch the built-in in place rather than appending, or a renamed
  // built-in would appear twice — once from config, once from its own row.
  const builtins = builtinOverrides.size
    ? WORKSPACES.map((w) => {
        const o = builtinOverrides.get(w.key);
        return o ? { ...w, label: o.label || w.label, blurb: o.blurb || w.blurb } : w;
      })
    : WORKSPACES;
  return [...builtins, ...dynamicCache];
}

export const getWorkspace = (key?: string): Workspace | undefined =>
  allWorkspaces().find((w) => w.key === key);

/** Whether the dynamic set has loaded — lets pages show a spinner instead of a
 *  false "not found" while a user-added workspace is still being fetched. */
export const dynamicWorkspacesReady = (): boolean => dynamicLoaded;

export function loadDynamicWorkspaces(force = false): Promise<void> {
  if (dynamicLoading && !force) return dynamicLoading;
  dynamicLoading = listWorkspaces()
    .then((rows) => {
      // A row whose key matches a built-in is an override, not a workspace of
      // its own. Splitting on the key rather than on `is_builtin` alone keeps a
      // row that somehow lost the flag from duplicating the section it renames.
      const builtinKeys = new Set(WORKSPACES.map((w) => w.key));
      dynamicCache = rows.filter((r) => !builtinKeys.has(r.key)).map(fromDynamic);
      builtinOverrides = new Map(
        rows.filter((r) => builtinKeys.has(r.key))
          .map((r) => [r.key, { label: r.label, blurb: r.blurb }]),
      );
      registerDynamicAccents(rows.map((r) => ({ key: r.key, accent: r.accent })));
      dynamicLoaded = true;
      listeners.forEach((l) => l());
    })
    .catch(() => { dynamicLoaded = true; })
    .finally(() => { dynamicLoading = null; });
  return dynamicLoading;
}

/** Reactive list of all workspaces (built-in + dynamic). Loads the dynamic set
 *  once and re-renders subscribers when it arrives or is refreshed. */
export function useWorkspaces(): Workspace[] {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    if (!dynamicLoaded) loadDynamicWorkspaces();
    return () => { listeners.delete(bump); };
  }, []);
  return allWorkspaces();
}
