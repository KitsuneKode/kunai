import { docNavEntries, hubGroups, hubRootCards, type DocNavGroup } from "./doc-navigation";

export type DocHubCard = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

export type DocHubGroup = {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly DocHubCard[];
};

export const docsRootCards: readonly DocHubCard[] = hubRootCards();

const USER_GROUP_IDS: readonly DocNavGroup[] = ["setup", "daily", "offline", "trust"];
const DEVELOPER_GROUP_IDS: readonly DocNavGroup[] = ["develop"];

function groupsFor(ids: readonly DocNavGroup[]): readonly DocHubGroup[] {
  return hubGroups()
    .filter((group) => ids.includes(group.id))
    .map((group) => ({
      id: group.id,
      eyebrow: group.eyebrow,
      title: group.title,
      description: group.description,
      items: group.items.map(({ title, href, description }) => ({ title, href, description })),
    }));
}

export const userGuideGroups: readonly DocHubGroup[] = groupsFor(USER_GROUP_IDS);

export const developerGuideGroups: readonly DocHubGroup[] = groupsFor(DEVELOPER_GROUP_IDS);

export type DocHubGroupId =
  | (typeof userGuideGroups)[number]["id"]
  | (typeof developerGuideGroups)[number]["id"];

export function getDocHubGroup(id: DocHubGroupId): DocHubGroup | undefined {
  return [...userGuideGroups, ...developerGuideGroups].find((group) => group.id === id);
}

/** All hub-linked entries for drift tests and sitemap helpers. */
export const allDocHubEntries = docNavEntries;
