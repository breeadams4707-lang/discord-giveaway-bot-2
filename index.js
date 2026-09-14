require("dotenv").config();

const axios = require("axios");

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require("discord.js");

const fs = require("fs");

// ======================================================
// CONFIG
// ======================================================

const SHOP_API_URL =
    process.env.SHOP_API_URL || "http://localhost:3000";

const DATA_FILE = "./data.json";

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ======================================================
// DATA
// ======================================================

let data = {
    giveaway: {
        active: false,
        prize: "",
        endTime: null,
        entries: {},
        invitedMembers: {}
    },
    leaderboardChannelId: null,
    leaderboardMessageId: null
};

if (fs.existsSync(DATA_FILE)) {
    try {
        data = JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
    } catch (error) {
        console.error(
            "❌ Could not read data.json:",
            error.message
        );
    }
}

function saveData() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(data, null, 2)
    );
}

// ======================================================
// INVITE CACHE
// ======================================================

const invites = new Map();

// ======================================================
// GET INVITES
// ======================================================

async function cacheInvites(guild) {
    try {
        const inviteCollection =
            await guild.invites.fetch();

        const inviteUses = new Map();

        inviteCollection.forEach(invite => {
            inviteUses.set(
                invite.code,
                invite.uses || 0
            );
        });

        invites.set(
            guild.id,
            inviteUses
        );

        console.log(
            `Cached invites for ${guild.name}`
        );
    } catch (error) {
        console.error(
            "❌ Could not cache invites:",
            error.message
        );
    }
}

// ======================================================
// FIND USED INVITE
// ======================================================

async function findUsedInvite(guild) {
    try {
        const oldInvites =
            invites.get(guild.id) || new Map();

        const newInviteCollection =
            await guild.invites.fetch();

        let usedInvite = null;

        newInviteCollection.forEach(invite => {
            const oldUses =
                oldInvites.get(invite.code) || 0;

            const newUses =
                invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite = invite;
            }
        });

        const newInviteUses = new Map();

        newInviteCollection.forEach(invite => {
            newInviteUses.set(
                invite.code,
                invite.uses || 0
            );
        });

        invites.set(
            guild.id,
            newInviteUses
        );

        return usedInvite;
    } catch (error) {
        console.error(
            "❌ Could not find used invite:",
            error.message
        );

        return null;
    }
}

// ======================================================
// LEADERBOARD
// ======================================================

async function updateLeaderboard() {
    try {
        if (!data.leaderboardChannelId) {
            return;
        }

        const channel =
            await client.channels.fetch(
                data.leaderboardChannelId
            );

        if (!channel) {
            return;
        }

        const entries =
            data.giveaway.entries || {};

        const sortedEntries =
            Object.entries(entries)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);

        let description = "";

        if (sortedEntries.length === 0) {
            description =
                "No giveaway entries yet.";
        } else {
            for (
                let i = 0;
                i < sortedEntries.length;
                i++
            ) {
                const [
                    userId,
                    entryCount
                ] = sortedEntries[i];

                let username = "Unknown User";

                try {
                    const member =
                        await channel.guild.members.fetch(
                            userId
                        );

                    username =
                        member.user.username;
                } catch {
                    username =
                        `<@${userId}>`;
                }

                description +=
                    `**${i + 1}. ${username}** — ${entryCount} entries\n`;
            }
        }

        const embed =
            new EmbedBuilder()
                .setTitle(
                    "🏆 Giveaway Leaderboard"
                )
                .setDescription(
                    description
                )
                .setTimestamp();

        if (data.leaderboardMessageId) {
            try {
                const message =
                    await channel.messages.fetch(
                        data.leaderboardMessageId
                    );

                await message.edit({
                    embeds: [embed]
                });

                return;
            } catch {
                data.leaderboardMessageId =
                    null;
            }
        }

        const message =
            await channel.send({
                embeds: [embed]
            });

        data.leaderboardMessageId =
            message.id;

        saveData();
    } catch (error) {
        console.error(
            "❌ Could not update leaderboard:",
            error.message
        );
    }
}

// ======================================================
// GIVEAWAY FINISH
// ======================================================

async function finishGiveaway() {
    if (!data.giveaway.active) {
        return;
    }

    const entries =
        data.giveaway.entries || {};

    const entryList = [];

    for (const [
        userId,
        count
    ] of Object.entries(entries)) {
        for (let i = 0; i < count; i++) {
            entryList.push(userId);
        }
    }

    if (entryList.length === 0) {
        data.giveaway.active = false;
        data.giveaway.endTime = null;

        saveData();

        return;
    }

    const winnerId =
        entryList[
            Math.floor(
                Math.random() *
                entryList.length
            )
        ];

    const prize =
        data.giveaway.prize;

    data.giveaway.active = false;
    data.giveaway.endTime = null;

    saveData();

    const guild =
        client.guilds.cache.first();

    if (!guild) {
        return;
    }

    const channel =
        guild.channels.cache.find(
            channel =>
                channel.isTextBased() &&
                channel.permissionsFor(
                    client.user
                )?.has(
                    PermissionFlagsBits.SendMessages
                )
        );

    if (!channel) {
        console.error(
            "❌ Could not find a channel to announce giveaway winner."
        );

        return;
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                "🎉 Giveaway Ended!"
            )
            .setDescription(
                `**Prize:** ${prize}\n\n` +
                `🏆 **Winner:** <@${winnerId}>`
            )
            .setTimestamp();

    await channel.send({
        embeds: [embed]
    });

    await updateLeaderboard();
}

// ======================================================
// GIVEAWAY TIMER
// ======================================================

function startGiveawayTimer() {
    if (
        !data.giveaway.active ||
        !data.giveaway.endTime
    ) {
        return;
    }

    const remaining =
        data.giveaway.endTime -
        Date.now();

    if (remaining <= 0) {
        finishGiveaway();
        return;
    }

    setTimeout(() => {
        finishGiveaway();
    }, remaining);
}

// ======================================================
// MEMBER JOIN
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const usedInvite =
                await findUsedInvite(
                    member.guild
                );

            if (
                !usedInvite ||
                !usedInvite.inviter
            ) {
                return;
            }

            const inviterId =
                usedInvite.inviter.id;

            if (
                inviterId === member.id
            ) {
                return;
            }

            if (
                !data.giveaway.active
            ) {
                return;
            }

            if (
                !data.giveaway.entries[
                    inviterId
                ]
            ) {
                data.giveaway.entries[
                    inviterId
                ] = 1;
            }

            data.giveaway.entries[
                inviterId
            ]++;

            if (
                !data.giveaway.invitedMembers[
                    inviterId
                ]
            ) {
                data.giveaway.invitedMembers[
                    inviterId
                ] = [];
            }

            data.giveaway.invitedMembers[
                inviterId
            ].push(member.id);

            saveData();

            await updateLeaderboard();

            console.log(
                `${usedInvite.inviter.username} invited ${member.user.username}`
            );
        } catch (error) {
            console.error(
                "❌ Error handling member join:",
                error.message
            );
        }
    }
);

// ======================================================
// MEMBER LEAVE
// ======================================================

client.on(
    "guildMemberRemove",
    async member => {
        try {
            if (
                !data.giveaway.active
            ) {
                return;
            }

            const invitedMembers =
                data.giveaway
                    .invitedMembers || {};

            for (const [
                inviterId,
                memberIds
            ] of Object.entries(
                invitedMembers
            )) {
                const index =
                    memberIds.indexOf(
                        member.id
                    );

                if (index !== -1) {
                    memberIds.splice(
                        index,
                        1
                    );

                    if (
                        data.giveaway.entries[
                            inviterId
                        ] > 1
                    ) {
                        data.giveaway.entries[
                            inviterId
                        ]--;
                    }

                    saveData();

                    await updateLeaderboard();

                    console.log(
                        `Removed giveaway entry because ${member.user?.username || member.id} left.`
                    );

                    break;
                }
            }
        } catch (error) {
            console.error(
                "❌ Error handling member leave:",
                error.message
            );
        }
    }
);

// ======================================================
// BOT READY
// ======================================================

client.once(
    "ready",
    async () => {
        console.log(
            `Logged in as ${client.user.tag}`
        );

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            await cacheInvites(guild);
        }

        console.log(
            "Giveaway timer restored."
        );

        startGiveawayTimer();

        await updateLeaderboard();
    }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

    // ==================================================
    // SHOP
    // ==================================================

    new SlashCommandBuilder()
        .setName("shop")
        .setDescription(
            "View products in the ARK shop"
        )
        .addStringOption(option =>
            option
                .setName("category")
                .setDescription(
                    "Search for a shop category"
                )
                .setRequired(false)
                .setAutocomplete(true)
        ),

    // ==================================================
    // ENTRIES
    // ==================================================

    new SlashCommandBuilder()
        .setName("entries")
        .setDescription(
            "View your giveaway entries"
        ),

    // ==================================================
    // LEADERBOARD
    // ==================================================

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(
            "View the giveaway leaderboard"
        ),

    // ==================================================
    // START GIVEAWAY
    // ==================================================

    new SlashCommandBuilder()
        .setName("startgiveaway")
        .setDescription(
            "Start a giveaway"
        )
        .addStringOption(option =>
            option
                .setName("prize")
                .setDescription(
                    "What is being given away?"
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("hours")
                .setDescription(
                    "How many hours should the giveaway last?"
                )
                .setRequired(true)
                .setMinValue(1)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    // ==================================================
    // END GIVEAWAY
    // ==================================================

    new SlashCommandBuilder()
        .setName("endgiveaway")
        .setDescription(
            "End the current giveaway"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    // ==================================================
    // SET LEADERBOARD
    // ==================================================

    new SlashCommandBuilder()
        .setName("setleaderboard")
        .setDescription(
            "Set this channel as the giveaway leaderboard channel"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )

].map(command =>
    command.toJSON()
);

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {
    try {
        console.log(
            "Registering slash commands..."
        );

        const rest =
            new REST({
                version: "10"
            }).setToken(
                process.env.DISCORD_TOKEN
            );

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "Slash commands registered!"
        );
    } catch (error) {
        console.error(
            "❌ Could not register slash commands:",
            error
        );
    }
}

// ======================================================
// GET SHOP PRODUCTS
// ======================================================

async function getShopProducts() {
    console.log(
        "SHOP URL:",
        `${SHOP_API_URL}/api/products`
    );

    const response =
        await axios.get(
            `${SHOP_API_URL}/api/products`
        );

    const products =
        response.data.filter(
            product =>
                product.status ===
                "published"
        );

    return products;
}

// ======================================================
// GET SHOP CATEGORIES
// ======================================================

function getShopCategories(products) {
    return [
        ...new Set(
            products
                .map(product =>
                    product.category?.trim()
                )
                .filter(Boolean)
        )
    ];
}

// ======================================================
// CREATE PRODUCT EMBEDS
// ======================================================

function createProductEmbeds(products) {
    return products
        .slice(0, 10)
        .map(product => {

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `🦖 ${product.name}`
                    )
                    .setDescription(
                        product.details ||
                        "No details available."
                    )
                    .addFields(
                        {
                            name:
                                "📁 Category",
                            value:
                                product.category ||
                                "Uncategorized",
                            inline:
                                true
                        },
                        {
                            name:
                                "💰 Price",
                            value:
                                product.price ||
                                "Contact us",
                            inline:
                                true
                        }
                    );

            if (product.image) {
                embed.setImage(
                    product.image
                );
            }

            return embed;
        });
}

// ======================================================
// CREATE SHOP CATEGORY MENU
// ======================================================

function createShopCategoryMenu(categories) {

    const options = [
        {
            label: "All Products",
            description:
                "View every product in the shop",
            value: "ALL_PRODUCTS",
            emoji: "🛒"
        }
    ];

    // Discord allows a maximum of 25
    // options in a select menu.
    // One option is reserved for All Products.

    for (
        const category of
        categories.slice(0, 24)
    ) {

        options.push({
            label:
                category.substring(0, 100),

            description:
                `View ${category} products`
                    .substring(0, 100),

            value:
                category.substring(0, 100),

            emoji: "📁"
        });
    }

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId(
                "shop_category"
            )
            .setPlaceholder(
                "🔎 Select a category..."
            )
            .addOptions(
                options
            );

    return new ActionRowBuilder()
        .addComponents(
            menu
        );
}

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // ==========================================
            // SHOP CATEGORY AUTOCOMPLETE
            // ==========================================

            if (
                interaction.isAutocomplete() &&
                interaction.commandName ===
                    "shop"
            ) {

                try {

                    const products =
                        await getShopProducts();

                    const categories =
                        getShopCategories(
                            products
                        );

                    const search =
                        interaction.options
                            .getString(
                                "category"
                            )
                            ?.toLowerCase() ||
                        "";

                    const filtered =
                        categories
                            .filter(category =>
                                category
                                    .toLowerCase()
                                    .includes(
                                        search
                                    )
                            )
                            .slice(0, 25);

                    await interaction.respond(
                        filtered.map(
                            category => ({
                                name:
                                    category.substring(
                                        0,
                                        100
                                    ),
                                value:
                                    category.substring(
                                        0,
                                        100
                                    )
                            })
                        )
                    );

                    return;

                } catch (error) {

                    console.error(
                        "❌ Shop autocomplete error:",
                        error.message
                    );

                    try {
                        await interaction.respond(
                            []
                        );
                    } catch {}
                }

                return;
            }

            // ==========================================
            // SHOP COMMAND
            // ==========================================

            if (
                interaction.commandName ===
                "shop"
            ) {

                try {

                    const products =
                        await getShopProducts();

                    if (
                        products.length === 0
                    ) {

                        await interaction.reply({
                            content:
                                "🛒 The shop currently has no published products.",
                            ephemeral: true
                        });

                        return;
                    }

                    const selectedCategory =
                        interaction.options.getString(
                            "category"
                        );

                    // ----------------------------------
                    // CATEGORY WAS SEARCHED
                    // ----------------------------------

                    if (
                        selectedCategory
                    ) {

                        const filteredProducts =
                            products.filter(
                                product =>
                                    (
                                        product.category ||
                                        ""
                                    ).trim().toLowerCase() ===
                                    selectedCategory.trim().toLowerCase()
                            );

                        if (
                            filteredProducts.length ===
                            0
                        ) {

                            await interaction.reply({
                                content:
                                    `❌ No products were found in the **${selectedCategory}** category.`,
                                ephemeral: true
                            });

                            return;
                        }

                        const embeds =
                            createProductEmbeds(
                                filteredProducts
                            );

                        await interaction.reply({
                            content:
                                `📁 **${selectedCategory}**`,
                            embeds
                        });

                        return;
                    }

                    // ----------------------------------
                    // NO CATEGORY
                    // SHOW CATEGORY MENU
                    // ----------------------------------

                    const categories =
                        getShopCategories(
                            products
                        );

                    if (
                        categories.length === 0
                    ) {

                        const embeds =
                            createProductEmbeds(
                                products
                            );

                        await interaction.reply({
                            embeds
                        });

                        return;
                    }

                    const row =
                        createShopCategoryMenu(
                            categories
                        );

                    await interaction.reply({
                        content:
                            "🛒 **ARK SHOP**\n\nChoose a category below, or use `/shop category:` to search for one.",
                        components: [row],
                        ephemeral: true
                    });

                } catch (error) {

                    console.error(
                        "❌ Could not load shop products:",
                        error.message
                    );

                    await interaction.reply({
                        content:
                            "❌ I couldn't connect to the ARK shop right now.",
                        ephemeral: true
                    });
                }

                return;
            }

            // ==========================================
            // SHOP CATEGORY MENU
            // ==========================================

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    "shop_category"
            ) {

                try {

                    const selectedCategory =
                        interaction.values[0];

                    const products =
                        await getShopProducts();

                    // ----------------------------------
                    // ALL PRODUCTS
                    // ----------------------------------

                    if (
                        selectedCategory ===
                        "ALL_PRODUCTS"
                    ) {

                        const embeds =
                            createProductEmbeds(
                                products
                            );

                        await interaction.update({
                            content:
                                "🛒 **All Products**",
                            embeds,
                            components: [
                                createShopCategoryMenu(
                                    getShopCategories(
                                        products
                                    )
                                )
                            ]
                        });

                        return;
                    }

                    // ----------------------------------
                    // FILTER CATEGORY
                    // ----------------------------------

                    const filteredProducts =
                        products.filter(
                            product =>
                                (
                                    product.category ||
                                    ""
                                ).trim().toLowerCase() ===
                                selectedCategory.trim().toLowerCase()
                        );

                    if (
                        filteredProducts.length ===
                        0
                    ) {

                        await interaction.update({
                            content:
                                `❌ No products found in **${selectedCategory}**.`,
                            embeds: [],
                            components: [
                                createShopCategoryMenu(
                                    getShopCategories(
                                        products
                                    )
                                )
                            ]
                        });

                        return;
                    }

                    const embeds =
                        createProductEmbeds(
                            filteredProducts
                        );

                    await interaction.update({
                        content:
                            `📁 **${selectedCategory}**`,
                        embeds,
                        components: [
                            createShopCategoryMenu(
                                getShopCategories(
                                    products
                                )
                            )
                        ]
                    });

                } catch (error) {

                    console.error(
                        "❌ Could not load shop category:",
                        error.message
                    );

                    try {

                        await interaction.update({
                            content:
                                "❌ I couldn't load that shop category.",
                            embeds: [],
                            components: []
                        });

                    } catch {}
                }

                return;
            }

            // ==========================================
            // ENTRIES COMMAND
            // ==========================================

            if (
                interaction.commandName ===
                "entries"
            ) {

                const userId =
                    interaction.user.id;

                const entries =
                    data.giveaway.entries[
                        userId
                    ] || 0;

                await interaction.reply({
                    content:
                        `🎟️ You currently have **${entries} giveaway entries**.`,
                    ephemeral: true
                });

                return;
            }

            // ==========================================
            // LEADERBOARD COMMAND
            // ==========================================

            if (
                interaction.commandName ===
                "leaderboard"
            ) {

                const entries =
                    data.giveaway.entries ||
                    {};

                const sortedEntries =
                    Object.entries(entries)
                        .sort(
                            (a, b) =>
                                b[1] - a[1]
                        )
                        .slice(0, 10);

                let description = "";

                if (
                    sortedEntries.length ===
                    0
                ) {

                    description =
                        "No entries yet.";

                } else {

                    for (
                        let i = 0;
                        i <
                        sortedEntries.length;
                        i++
                    ) {

                        const [
                            userId,
                            count
                        ] =
                            sortedEntries[i];

                        description +=
                            `**${i + 1}.** <@${userId}> — **${count} entries**\n`;
                    }
                }

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🏆 Giveaway Leaderboard"
                        )
                        .setDescription(
                            description
                        );

                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });

                return;
            }

            // ==========================================
            // START GIVEAWAY
            // ==========================================

            if (
                interaction.commandName ===
                "startgiveaway"
            ) {

                const prize =
                    interaction.options.getString(
                        "prize"
                    );

                const hours =
                    interaction.options.getInteger(
                        "hours"
                    );

                if (
                    data.giveaway.active
                ) {

                    await interaction.reply({
                        content:
                            "❌ A giveaway is already active.",
                        ephemeral: true
                    });

                    return;
                }

                data.giveaway = {
                    active: true,
                    prize,
                    endTime:
                        Date.now() +
                        hours *
                            60 *
                            60 *
                            1000,
                    entries: {},
                    invitedMembers: {}
                };

                saveData();

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🎉 GIVEAWAY!"
                        )
                        .setDescription(
                            `🎁 **Prize:** ${prize}\n\n` +
                            `⏰ **Duration:** ${hours} hour(s)\n\n` +
                            `🎟️ Everyone starts with 1 entry.\n` +
                            `👥 Each successful invite gives you +1 entry.\n` +
                            `🔄 Entries are removed if the invited member leaves.\n\n` +
                            `🏆 The winner is selected randomly, weighted by entries.`
                        )
                        .setTimestamp();

                const button =
                    new ButtonBuilder()
                        .setCustomId(
                            "enter_giveaway"
                        )
                        .setLabel(
                            "Enter Giveaway"
                        )
                        .setEmoji("🎟️")
                        .setStyle(
                            ButtonStyle.Success
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            button
                        );

                await interaction.reply({
                    content:
                        "🎉 Giveaway started!",
                    ephemeral: true
                });

                await interaction.channel.send({
                    embeds: [embed],
                    components: [row]
                });

                await updateLeaderboard();

                startGiveawayTimer();

                return;
            }

            // ==========================================
            // END GIVEAWAY
            // ==========================================

            if (
                interaction.commandName ===
                "endgiveaway"
            ) {

                if (
                    !data.giveaway.active
                ) {

                    await interaction.reply({
                        content:
                            "❌ There is no active giveaway.",
                        ephemeral: true
                    });

                    return;
                }

                await interaction.reply({
                    content:
                        "⏹️ Ending giveaway...",
                    ephemeral: true
                });

                await finishGiveaway();

                return;
            }

            // ==========================================
            // SET LEADERBOARD
            // ==========================================

            if (
                interaction.commandName ===
                "setleaderboard"
            ) {

                data.leaderboardChannelId =
                    interaction.channel.id;

                data.leaderboardMessageId =
                    null;

                saveData();

                await updateLeaderboard();

                await interaction.reply({
                    content:
                        "✅ This channel is now the giveaway leaderboard channel.",
                    ephemeral: true
                });

                return;
            }

            // ==========================================
            // ENTER GIVEAWAY BUTTON
            // ==========================================

            if (
                interaction.isButton() &&
                interaction.customId ===
                    "enter_giveaway"
            ) {

                if (
                    !data.giveaway.active
                ) {

                    await interaction.reply({
                        content:
                            "❌ There is no active giveaway.",
                        ephemeral: true
                    });

                    return;
                }

                const userId =
                    interaction.user.id;

                if (
                    data.giveaway.entries[
                        userId
                    ]
                ) {

                    await interaction.reply({
                        content:
                            `🎟️ You are already entered with **${data.giveaway.entries[userId]} entries**.`,
                        ephemeral: true
                    });

                    return;
                }

                data.giveaway.entries[
                    userId
                ] = 1;

                if (
                    !data.giveaway.invitedMembers[
                        userId
                    ]
                ) {

                    data.giveaway.invitedMembers[
                        userId
                    ] = [];
                }

                saveData();

                await interaction.reply({
                    content:
                        "🎟️ You are now entered into the giveaway with **1 entry**!",
                    ephemeral: true
                });

                await updateLeaderboard();

                return;
            }

        } catch (error) {

            console.error(
                "❌ Interaction error:",
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {

                try {

                    await interaction.followUp({
                        content:
                            "❌ Something went wrong.",
                        ephemeral: true
                    });

                } catch {}

            } else {

                try {

                    await interaction.reply({
                        content:
                            "❌ Something went wrong.",
                        ephemeral: true
                    });

                } catch {}
            }
        }
    }
);

// ======================================================
// START BOT
// ======================================================

(async () => {

    await registerCommands();

    await client.login(
        process.env.DISCORD_TOKEN
    );

})();