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
  /** True for user-created sections (deletable); false for built-in ones. */
  isCustom?: boolean;
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
}

export const WORKSPACES: Workspace[] = [
  {
    key: "amazon-usa",
    label: "Amazon USA",
    Icon: StorefrontRoundedIcon,
    blurb: "Selling on the Amazon US marketplace.",
    sections: [
      "Product", "Category", "Product registration", "Amazon registration",
      "Product packing details", "Label design", "Listings & catalog", "Inventory & FBA",
      "Advertising (PPC)", "Reviews & ratings", "A+ content & storefront", "Returns & cases",
    ],
    categories: [
      {
        name: "Product",
        blurb: "The catalogue of products sold on Amazon US.",
        fields: ["Product name", "Product ID", "SKU", "ASIN", "Brand", "Category", "Description", "Unit price (USD)", "Net weight", "Dimensions", "Status"],
      },
      {
        name: "Category",
        blurb: "Product groupings and Amazon browse nodes.",
        fields: ["Category name", "Category ID", "Parent category", "Amazon browse node", "Description", "Products count"],
      },
      {
        name: "Product registration",
        blurb: "Regulatory registration status for each product.",
        fields: ["Registration ID", "Product", "Registration type", "Authority", "Status", "Submission date", "Approval date", "Certificate no.", "Expiry date"],
      },
      {
        name: "Amazon registration",
        blurb: "Seller-account and Brand Registry status on Amazon.",
        fields: ["Seller account", "Marketplace", "Brand Registry status", "GTIN / UPC", "ASIN", "Listing status", "Category approval", "Approval date"],
      },
      {
        name: "Product packing details",
        blurb: "Pack sizes, case configuration and barcodes.",
        fields: ["Product", "Pack size", "Units per case", "Case dimensions", "Case weight", "Packaging type", "Barcode (UPC)", "Labels per pack"],
      },
      {
        name: "Label design",
        blurb: "Artwork versions and label approvals.",
        fields: ["Label ID", "Product", "Version", "Language", "Design status", "Approved by", "Approval date", "Artwork file", "Print spec"],
      },
      {
        name: "Listings & catalog",
        blurb: "Live product listings on the marketplace.",
        fields: ["ASIN", "Title", "SKU", "Price (USD)", "Buy Box %", "Listing status", "Last updated"],
      },
      {
        name: "Inventory & FBA",
        blurb: "Stock levels and fulfillment.",
        fields: ["SKU", "FNSKU", "Available units", "Inbound units", "Reserved units", "Fulfillment", "Restock date"],
      },
      {
        name: "Advertising (PPC)",
        blurb: "Sponsored campaigns and ad performance.",
        fields: ["Campaign", "Type (SP / SB / SD)", "Daily budget", "ACoS", "Spend", "Sales", "Status"],
      },
      {
        name: "Reviews & ratings",
        blurb: "Customer feedback and responses.",
        fields: ["ASIN", "Star rating", "Review count", "Latest review", "Sentiment", "Response status"],
      },
      {
        name: "A+ content & storefront",
        blurb: "Enhanced brand content and the storefront.",
        fields: ["ASIN", "Content type", "Modules", "Status", "Published date", "Approved by"],
      },
      {
        name: "Returns & cases",
        blurb: "Returns, claims and A-to-z cases.",
        fields: ["Case ID", "Order ID", "Type", "Reason", "Amount (USD)", "Status", "Opened date"],
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

export const getWorkspace = (key?: string): Workspace | undefined =>
  WORKSPACES.find((w) => w.key === key);
