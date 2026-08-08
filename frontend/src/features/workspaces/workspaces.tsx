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
    sections: ["Campaign plan", "Content calendar", "Creatives & assets", "Email campaigns", "Performance tracking"],
    categories: [
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
    sections: ["WhatsApp", "LinkedIn", "Instagram", "Facebook", "YouTube", "X (Twitter)", "Content calendar"],
    categories: [
      { name: "WhatsApp", blurb: "WhatsApp channel activity and content.", fields: ["Description"] },
      { name: "LinkedIn", blurb: "LinkedIn posts and engagement.", fields: ["Description"] },
      { name: "Instagram", blurb: "Instagram content and campaigns.", fields: ["Description"] },
      { name: "Facebook", blurb: "Facebook page posts and ads.", fields: ["Description"] },
      { name: "YouTube", blurb: "YouTube videos and channel.", fields: ["Description"] },
      { name: "X (Twitter)", blurb: "Posts and engagement on X.", fields: ["Description"] },
      { name: "Content calendar", blurb: "Planned social content schedule.", fields: ["Description"] },
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
let dynamicLoaded = false;
let dynamicLoading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function allWorkspaces(): Workspace[] {
  return [...WORKSPACES, ...dynamicCache];
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
      dynamicCache = rows.map(fromDynamic);
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
