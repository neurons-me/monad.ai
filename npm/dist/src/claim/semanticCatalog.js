"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLLS_STUDIO_DEFAULT_CATEGORIES = exports.ROOT_SCHEMA_SEEDS = void 0;
exports.buildPollsStudioCategorySeeds = buildPollsStudioCategorySeeds;
exports.buildClaimSemanticSeeds = buildClaimSemanticSeeds;
exports.ROOT_SCHEMA_SEEDS = [
    { path: "schema.role.group.status", data: "adopted" },
    { path: "schema.role.group.behavior.type", data: "entity" },
    { path: "schema.role.group.suggest.contains", data: ["member", "policy", "channel"] },
    { path: "schema.role.member.status", data: "adopted" },
    { path: "schema.role.member.behavior.type", data: "collection" },
    { path: "schema.role.member.behavior.iterator", data: "username" },
    { path: "schema.role.member.suggest.contains", data: ["identity", "permissions", "joined_at"] },
    { path: "schema.role.keys.status", data: "adopted" },
    { path: "schema.role.keys.behavior.type", data: "entity" },
    { path: "schema.role.keys.suggest.contains", data: ["username", "password_hash", "namespace"] },
    { path: "schema.role.categories.status", data: "adopted" },
    { path: "schema.role.categories.behavior.type", data: "collection" },
    { path: "schema.role.categories.behavior.iterator", data: "slug" },
    { path: "schema.role.categories.suggest.contains", data: ["label", "description", "kind", "order"] },
    { path: "schema.role.surface.status", data: "adopted" },
    { path: "schema.role.surface.behavior.type", data: "entity" },
    { path: "schema.role.surface.suggest.contains", data: ["resource", "policy", "budget", "pressure"] },
    { path: "schema.role.resource.status", data: "adopted" },
    { path: "schema.role.resource.behavior.type", data: "entity" },
    { path: "schema.role.policy.status", data: "adopted" },
    { path: "schema.role.policy.behavior.type", data: "entity" },
    { path: "schema.role.budget.status", data: "adopted" },
    { path: "schema.role.budget.behavior.type", data: "entity" },
    { path: "schema.role.pressure.status", data: "adopted" },
    { path: "schema.role.pressure.behavior.type", data: "entity" },
    { path: "schema.field.surface.resource.cpu.type", data: "number" },
    { path: "schema.field.surface.resource.cpu.unit", data: "cores" },
    { path: "schema.field.surface.resource.memory.type", data: "number" },
    { path: "schema.field.surface.resource.memory.unit", data: "gb" },
    { path: "schema.field.surface.policy.gui.blockchain.limit.type", data: "number" },
    { path: "schema.field.surface.policy.gui.blockchain.limit.unit", data: "rows" },
    { path: "schema.field.surface.budget.gui.blockchain.rows.type", data: "number" },
    { path: "schema.field.surface.budget.gui.blockchain.rows.unit", data: "rows" },
    { path: "schema.field.surface.pressure.cpu.type", data: "number" },
    { path: "schema.field.surface.pressure.cpu.unit", data: "ratio" },
];
exports.POLLS_STUDIO_DEFAULT_CATEGORIES = [
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
function buildPollsStudioCategorySeeds(basePath = "polls.studio.categories") {
    return exports.POLLS_STUDIO_DEFAULT_CATEGORIES.flatMap((category) => {
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
function buildClaimSemanticSeeds(input) {
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
