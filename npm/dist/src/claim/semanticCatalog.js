function createRoleSeeds(role, config) {
    const seeds = [
        { path: `schema.role.${role}.status`, data: "adopted" },
        { path: `schema.role.${role}.behavior.type`, data: config.behaviorType },
    ];
    if (config.iterator) {
        seeds.push({ path: `schema.role.${role}.behavior.iterator`, data: config.iterator });
    }
    if (Array.isArray(config.contains) && config.contains.length > 0) {
        seeds.push({ path: `schema.role.${role}.suggest.contains`, data: config.contains });
    }
    return seeds;
}
function createFieldSeeds(path, type, unit) {
    const seeds = [{ path: `schema.field.${path}.type`, data: type }];
    if (unit) {
        seeds.push({ path: `schema.field.${path}.unit`, data: unit });
    }
    return seeds;
}
const ROOT_ROLE_SEEDS = [
    ...createRoleSeeds("user", {
        behaviorType: "entity",
        contains: ["profile", "relations", "host", "gui"],
    }),
    ...createRoleSeeds("profile", {
        behaviorType: "entity",
        contains: [
            "username",
            "name",
            "email",
            "phone",
            "type",
            "field",
            "birth_date",
            "death_date",
            "origin",
            "parent",
        ],
    }),
    ...createRoleSeeds("parent", {
        behaviorType: "entity",
        contains: ["father", "mother"],
    }),
    ...createRoleSeeds("host", {
        behaviorType: "collection",
        iterator: "host_key",
        contains: ["hostname", "label", "local_endpoint", "fingerprint", "status"],
    }),
    ...createRoleSeeds("group", {
        behaviorType: "entity",
        contains: ["member", "policy", "channel", "gui"],
    }),
    ...createRoleSeeds("member", {
        behaviorType: "collection",
        iterator: "username",
        contains: ["identity", "permissions", "joined_at"],
    }),
    ...createRoleSeeds("keys", {
        behaviorType: "entity",
        contains: ["username", "password_hash", "namespace"],
    }),
    ...createRoleSeeds("categories", {
        behaviorType: "collection",
        iterator: "slug",
        contains: ["label", "description", "kind", "order"],
    }),
    ...createRoleSeeds("gui", {
        behaviorType: "entity",
        contains: ["theme", "left", "right", "top", "footer", "page", "section"],
    }),
    ...createRoleSeeds("slot", {
        behaviorType: "entity",
        contains: ["nav", "context", "action", "title", "sticky", "collapsed"],
    }),
    ...createRoleSeeds("page", {
        behaviorType: "entity",
        contains: ["route", "title", "component", "sections"],
    }),
    ...createRoleSeeds("section", {
        behaviorType: "entity",
        contains: ["title", "view", "source", "order"],
    }),
    ...createRoleSeeds("theme", {
        behaviorType: "entity",
        contains: ["catalog", "mode", "accent"],
    }),
    ...createRoleSeeds("surface", {
        behaviorType: "entity",
        contains: ["resource", "usage", "policy", "budget", "pressure"],
    }),
    ...createRoleSeeds("resource", {
        behaviorType: "entity",
        contains: ["cpu", "memory", "storage", "network"],
    }),
    ...createRoleSeeds("usage", {
        behaviorType: "entity",
        contains: ["cpu", "memory", "storage", "network"],
    }),
    ...createRoleSeeds("policy", {
        behaviorType: "entity",
        contains: ["gui", "network", "compute"],
    }),
    ...createRoleSeeds("budget", {
        behaviorType: "entity",
        contains: ["gui", "network", "compute"],
    }),
    ...createRoleSeeds("pressure", {
        behaviorType: "entity",
        contains: ["cpu", "memory", "network"],
    }),
];
const ROOT_FIELD_SEEDS = [
    ...createFieldSeeds("profile.name", "string"),
    ...createFieldSeeds("profile.email", "string"),
    ...createFieldSeeds("profile.phone", "string"),
    ...createFieldSeeds("profile.type", "entity"),
    ...createFieldSeeds("profile.type.public_figure", "boolean"),
    ...createFieldSeeds("profile.field", "string"),
    ...createFieldSeeds("profile.birth_date", "date"),
    ...createFieldSeeds("profile.death_date", "date|null"),
    ...createFieldSeeds("profile.origin", "string"),
    ...createFieldSeeds("profile.parent", "entity"),
    ...createFieldSeeds("profile.parent.father", "string|null"),
    ...createFieldSeeds("profile.parent.mother", "string|null"),
    ...createFieldSeeds("group.id", "string"),
    ...createFieldSeeds("group.name", "string"),
    ...createFieldSeeds("group.created_at", "datetime"),
    ...createFieldSeeds("group.created_by", "namespace"),
    ...createFieldSeeds("member.namespace", "namespace"),
    ...createFieldSeeds("host.hostname", "string"),
    ...createFieldSeeds("host.label", "string"),
    ...createFieldSeeds("host.local_endpoint", "string"),
    ...createFieldSeeds("host.fingerprint", "string"),
    ...createFieldSeeds("host.status", "string"),
    ...createFieldSeeds("gui.route", "string"),
    ...createFieldSeeds("gui.component", "string"),
    ...createFieldSeeds("gui.order", "number"),
    ...createFieldSeeds("gui.icon", "string"),
    ...createFieldSeeds("gui.label", "string"),
    ...createFieldSeeds("gui.title", "string"),
    ...createFieldSeeds("gui.view", "string"),
    ...createFieldSeeds("gui.source", "string"),
    ...createFieldSeeds("gui.sticky", "boolean"),
    ...createFieldSeeds("gui.collapsed", "boolean"),
    ...createFieldSeeds("gui.catalog", "string"),
    ...createFieldSeeds("gui.mode", "string"),
    ...createFieldSeeds("surface.resource.cpu", "number", "cores"),
    ...createFieldSeeds("surface.resource.memory", "number", "gb"),
    ...createFieldSeeds("surface.usage.cpu", "number", "ratio"),
    ...createFieldSeeds("surface.usage.memory", "number", "ratio"),
    ...createFieldSeeds("surface.policy.gui.blockchain.limit", "number", "rows"),
    ...createFieldSeeds("surface.budget.gui.blockchain.rows", "number", "rows"),
    ...createFieldSeeds("surface.pressure.cpu", "number", "ratio"),
    ...createFieldSeeds("surface.pressure.memory", "number", "ratio"),
];
const ROOT_GUI_DEFAULT_SEEDS = [
    { path: "gui.theme.catalog.default", data: "mdrn.church" },
    { path: "gui.theme.mode.default", data: "light" },
    { path: "gui.left.role", data: "slot" },
    { path: "gui.left.sticky", data: true },
    { path: "gui.right.role", data: "slot" },
    { path: "gui.right.sticky", data: true },
    { path: "gui.top.role", data: "slot" },
    { path: "gui.top.sticky", data: true },
    { path: "gui.footer.role", data: "slot" },
    { path: "gui.page.home.role", data: "page" },
    { path: "gui.page.home.route", data: "/" },
    { path: "gui.page.home.title", data: "Cleaker" },
    { path: "gui.page.home.component", data: "Cleaker" },
    { path: "gui.page.home.sections", data: ["profile", "hosts"] },
    { path: "gui.page.blockchain.role", data: "page" },
    { path: "gui.page.blockchain.route", data: "/chain" },
    { path: "gui.page.blockchain.title", data: "Blockchain" },
    { path: "gui.page.blockchain.component", data: "Blockchain" },
    { path: "gui.page.blockchain.sections", data: ["blockchain"] },
    { path: "gui.page.group.role", data: "page" },
    { path: "gui.page.group.route", data: "/groups/:groupKey" },
    { path: "gui.page.group.title", data: "Group" },
    { path: "gui.page.group.component", data: "CleakerGroup" },
    { path: "gui.page.group.sections", data: ["profile", "members"] },
    { path: "gui.page.user.role", data: "page" },
    { path: "gui.page.user.route", data: "/@username" },
    { path: "gui.page.user.title", data: "User" },
    { path: "gui.page.user.component", data: "CleakerUser" },
    { path: "gui.page.user.sections", data: ["profile", "relations", "hosts"] },
    { path: "gui.section.profile.role", data: "section" },
    { path: "gui.section.profile.title", data: "Profile" },
    { path: "gui.section.profile.view", data: "profile" },
    { path: "gui.section.profile.source", data: "profile" },
    { path: "gui.section.profile.order", data: 10 },
    { path: "gui.section.members.role", data: "section" },
    { path: "gui.section.members.title", data: "Members" },
    { path: "gui.section.members.view", data: "members" },
    { path: "gui.section.members.source", data: "member" },
    { path: "gui.section.members.order", data: 20 },
    { path: "gui.section.relations.role", data: "section" },
    { path: "gui.section.relations.title", data: "Relations" },
    { path: "gui.section.relations.view", data: "relations" },
    { path: "gui.section.relations.source", data: "relations" },
    { path: "gui.section.relations.order", data: 30 },
    { path: "gui.section.hosts.role", data: "section" },
    { path: "gui.section.hosts.title", data: "Hosts" },
    { path: "gui.section.hosts.view", data: "hosts" },
    { path: "gui.section.hosts.source", data: "host" },
    { path: "gui.section.hosts.order", data: 40 },
    { path: "gui.section.blockchain.role", data: "section" },
    { path: "gui.section.blockchain.title", data: "Blockchain" },
    { path: "gui.section.blockchain.view", data: "blockchain" },
    { path: "gui.section.blockchain.source", data: "blockchain" },
    { path: "gui.section.blockchain.order", data: 50 },
    { path: "gui.left.nav.home.label", data: "Cleaker" },
    { path: "gui.left.nav.home.icon", data: "home" },
    { path: "gui.left.nav.home.route", data: "/" },
    { path: "gui.left.nav.home.order", data: 10 },
    { path: "gui.left.nav.chain.label", data: "Blockchain" },
    { path: "gui.left.nav.chain.icon", data: "account_tree" },
    { path: "gui.left.nav.chain.route", data: "/chain" },
    { path: "gui.left.nav.chain.order", data: 20 },
    { path: "gui.left.nav.groups.label", data: "Groups" },
    { path: "gui.left.nav.groups.icon", data: "groups" },
    { path: "gui.left.nav.groups.route", data: "/groups" },
    { path: "gui.left.nav.groups.order", data: 30 },
    { path: "gui.right.context.profile.label", data: "Profile" },
    { path: "gui.right.context.profile.icon", data: "badge" },
    { path: "gui.right.context.profile.order", data: 10 },
    { path: "gui.right.context.members.label", data: "Members" },
    { path: "gui.right.context.members.icon", data: "groups" },
    { path: "gui.right.context.members.order", data: 20 },
    { path: "gui.right.context.hosts.label", data: "Hosts" },
    { path: "gui.right.context.hosts.icon", data: "dns" },
    { path: "gui.right.context.hosts.order", data: 30 },
    { path: "gui.right.context.blockchain.label", data: "Blockchain" },
    { path: "gui.right.context.blockchain.icon", data: "account_tree" },
    { path: "gui.right.context.blockchain.order", data: 40 },
    { path: "gui.footer.context.namespace.label", data: "Namespace" },
    { path: "gui.footer.context.namespace.icon", data: "language" },
    { path: "gui.footer.context.namespace.order", data: 10 },
    { path: "gui.footer.context.user.label", data: "User" },
    { path: "gui.footer.context.user.icon", data: "alternate_email" },
    { path: "gui.footer.context.user.order", data: 20 },
    { path: "gui.footer.context.group.label", data: "Group" },
    { path: "gui.footer.context.group.icon", data: "groups" },
    { path: "gui.footer.context.group.order", data: 30 },
    { path: "gui.footer.action.theme.label", data: "Theme Catalog" },
    { path: "gui.footer.action.theme.icon", data: "palette" },
    { path: "gui.footer.action.theme.order", data: 90 },
];
export const ROOT_SCHEMA_SEEDS = [
    ...ROOT_ROLE_SEEDS,
    ...ROOT_FIELD_SEEDS,
    ...ROOT_GUI_DEFAULT_SEEDS,
];
export const POLLS_STUDIO_DEFAULT_CATEGORIES = [
    {
        slug: "community",
        label: "Community",
        description: "Neighbors, local groups, causes, and mutual aid.",
        kind: "community",
        order: 10,
    },
    {
        slug: "events",
        label: "Events",
        description: "Public happenings, meetups, and upcoming gatherings.",
        kind: "events",
        order: 20,
    },
    {
        slug: "jobs",
        label: "Jobs",
        description: "Open roles, hiring posts, and work opportunities.",
        kind: "jobs",
        order: 30,
    },
    {
        slug: "housing",
        label: "Housing",
        description: "Rentals, rooms, homes, and shared living spaces.",
        kind: "housing",
        order: 40,
    },
    {
        slug: "services",
        label: "Services",
        description: "Professional services, repairs, classes, and help.",
        kind: "services",
        order: 50,
    },
    {
        slug: "gigs",
        label: "Gigs",
        description: "Short-term work, freelance requests, and quick tasks.",
        kind: "gigs",
        order: 60,
    },
    {
        slug: "for-sale",
        label: "For Sale",
        description: "Things people are offering right now.",
        kind: "market",
        order: 70,
    },
    {
        slug: "wanted",
        label: "Wanted",
        description: "Things people are actively looking for.",
        kind: "market",
        order: 80,
    },
];
export function buildPollsStudioCategorySeeds(basePath = "polls.studio.categories") {
    return POLLS_STUDIO_DEFAULT_CATEGORIES.flatMap((category) => {
        const categoryBase = `${basePath}.${category.slug}`;
        return [
            { path: `${categoryBase}.slug`, data: category.slug },
            { path: `${categoryBase}.label`, data: category.label },
            { path: `${categoryBase}.description`, data: category.description },
            { path: `${categoryBase}.kind`, data: category.kind },
            { path: `${categoryBase}.order`, data: category.order },
        ];
    });
}
export function buildClaimSemanticSeeds(input) {
    const namespace = String(input.namespace || "").trim().toLowerCase();
    const username = String(input.username || "").trim().toLowerCase();
    const passwordHash = String(input.passwordHash || "").trim();
    const seeds = [
        { path: "keys.username", data: username },
        { path: "keys.password_hash", data: passwordHash },
        { path: "keys.namespace", data: namespace },
    ];
    return [...seeds, ...buildPollsStudioCategorySeeds()];
}
