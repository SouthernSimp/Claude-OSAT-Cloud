import {
  BookOpenText,
  CalendarBlank,
  CurrencyDollar,
  DotsThree,
  Files,
  Globe,
  TerminalWindow,
  FolderSimple,
  GearSix,
  ListChecks,
  NotePencil,
  ShareNetwork,
  MoonStars,
  Sparkle,
  SunHorizon,
  Plus,
  Tray,
  UploadSimple,
} from "@phosphor-icons/react";

export const CORE_NAV = [
  { id: "Today", label: "Today", icon: SunHorizon, description: "The day, and the desk beside it" },
  { id: "Notes", label: "Notes", icon: NotePencil, description: "The pages themselves" },
  { id: "Mindmap", label: "Mindmap", icon: ShareNetwork, description: "The same notes, arranged by hand" },
  { id: "Sky", label: "Sky", icon: MoonStars, description: "Every note as a star" },
];

export const TOOL_NAV = [
  { id: "Inbox", label: "Inbox", icon: Tray, description: "Every capture, as it arrived" },
  { id: "Assistant", label: "Local AI", icon: Sparkle, description: "Think out loud, on this Mac" },
  { id: "Calendar", label: "Calendar", icon: CalendarBlank, description: "The month, and the day in it" },
  { id: "Habits", label: "Habits", icon: ListChecks, description: "Small things, kept daily" },
  { id: "Reflection", label: "Reflect", icon: BookOpenText, description: "Three quiet questions" },
  { id: "Budget", label: "Money", icon: CurrencyDollar, description: "A ledger you keep by hand" },
  { id: "Browser", label: "Browser", icon: Globe, description: "The web, with a clipper into Notes" },
  { id: "Terminal", label: "Terminal", icon: TerminalWindow, description: "Your shell, in the Mac app" },
];

export const FOOT_NAV = [
  { id: "Settings", label: "Settings", icon: GearSix, description: "Appearance, backup, boundaries" },
  { id: "More", label: "Library", icon: DotsThree },
];

export const PRIMARY_NAV = [
  { id: "Today", label: "Today", icon: SunHorizon },
  { id: "Notes", label: "Notes", icon: NotePencil },
  { id: "Capture", label: "New", icon: Plus },
  { id: "Mindmap", label: "Map", icon: ShareNetwork },
  { id: "More", label: "More", icon: DotsThree },
];

export const WORKFLOW_NAV = CORE_NAV;

export const MODULES = [
  { id: "Projects", label: "Projects", icon: FolderSimple, description: "Work and safe links" },
  { id: "Files", label: "Files", icon: Files, description: "Approved local files" },
  { id: "Journal", label: "Journal", icon: BookOpenText, description: "A page for every day" },
  { id: "Obsidian", label: "Obsidian", icon: UploadSimple, description: "Markdown export" },
];

export const DATE_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric",
}).format(new Date());

export const REFLECTION_PROMPTS = [
  ["win", "What moved forward?"],
  ["hard", "What felt difficult?"],
  ["tomorrow", "What is the next honest step?"],
];
