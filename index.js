require("dotenv").config();

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
    ChannelType
} = require("discord.js");

const fs = require("fs");

// ======================================================
// CONFIG
// ======================================================

const DATA_FILE = "./data.json";

const SELLER_TAX_RATE = 0.20;

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
    leaderboardMessageId: null,

    sellers: {},

    nextSaleId: 1
};

// ======================================================
// LOAD DATA
// ======================================================

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

// Make sure older data.json files still work
if (!data.giveaway) {
    data.giveaway = {
        active: false,
        prize: "",
        endTime: null,
        entries: {},
        invitedMembers: {}
    };
}

if (!data.giveaway.entries) {
    data.giveaway.entries = {};
}

if (!data.giveaway.invitedMembers) {
    data.giveaway.invitedMembers = {};
}

if (!data.sellers) {
    data.sellers = {};
}

if (!data.nextSaleId) {
    data.nextSaleId = 1;
}

// ======================================================
// SAVE DATA
// ======================================================

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
// CACHE INVITES
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
            invites.get(guild.id) ||
            new Map();

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
// SELLER SYSTEM
// ======================================================

function getSeller(userId) {

    if (!data.sellers[userId]) {

        data.sellers[userId] = {

            channelId: null,

            messageId: null,

            totalSales: 0,

            salesCount: 0,

            totalTax: 0,

            lifetimeOrders: 0,

            salesHistory: []
        };
    }

    return data.sellers[userId];
}

// ======================================================
// MONEY FORMAT
// ======================================================

function money(value) {

    return `$${Number(value || 0).toFixed(2)}`;
}

// ======================================================
// SELLER EMBED
// ======================================================

function createSellerEmbed(user) {

    const seller =
        getSeller(user.id);

    const history =
        seller.salesHistory || [];

    const recentSales =
        history
            .slice(-10)
            .reverse();

    let historyText =
        "No sales recorded yet.";

    if (recentSales.length > 0) {

        historyText =
            recentSales
                .map(sale => {

                    const date =
                        new Date(
                            sale.timestamp
                        );

                    return (
                        `🆔 **#${sale.id}** ` +
                        `💰 ${money(sale.amount)} ` +
                        `🧾 Tax: ${money(sale.tax)} ` +
                        `📅 ${date.toLocaleDateString(
                            "en-US",
                            {
                                month: "short",
                                day: "numeric"
                            }
                        )}`
                    );

                })
                .join("\n");
    }

    const sellerKeeps =
        Number(seller.totalSales || 0) -
        Number(seller.totalTax || 0);

    return new EmbedBuilder()

        .setTitle("📊 Seller Panel")

        .setDescription(
            `${user}`
        )

        .addFields(

            {
                name: "💰 Total Sales",

                value:
                    money(
                        seller.totalSales
                    ),

                inline: true
            },

            {
                name: "📦 Sales",

                value:
                    String(
                        seller.salesCount || 0
                    ),

                inline: true
            },

            {
                name: "💸 Tax Owed (20%)",

                value:
                    money(
                        seller.totalTax
                    ),

                inline: true
            },

            {
                name: "💵 Seller Earnings",

                value:
                    money(
                        sellerKeeps
                    ),

                inline: true
            },

            {
                name: "📜 Sales History",

                value:
                    historyText.substring(
                        0,
                        1024
                    ),

                inline: false
            },

            {
                name: "📦 Lifetime Orders",

                value:
                    String(
                        seller.lifetimeOrders || 0
                    ),

                inline: true
            }
        )

        .setFooter({
            text:
                `Last Update: ${new Date().toLocaleString(
                    "en-US"
                )}`
        });
}

// ======================================================
// UPDATE SELLER PANEL
// ======================================================

async function updateSellerPanel(
    userId,
    guild
) {

    const seller =
        getSeller(userId);

    if (
        !seller.channelId ||
        !guild
    ) {
        return false;
    }

    let user;

    try {

        user =
            await client.users.fetch(
                userId
            );

    } catch {

        return false;
    }

    let channel;

    try {

        channel =
            await guild.channels.fetch(
                seller.channelId
            );

    } catch {

        channel = null;
    }

    if (
        !channel ||
        !channel.isTextBased()
    ) {

        return false;
    }

    const embed =
        createSellerEmbed(user);

    // Edit existing panel
    if (seller.messageId) {

        try {

            const message =
                await channel.messages.fetch(
                    seller.messageId
                );

            await message.edit({
                embeds: [embed]
            });

            return true;

        } catch {

            seller.messageId = null;
        }
    }

    // Create panel if it doesn't exist
    const message =
        await channel.send({
            embeds: [embed]
        });

    seller.messageId =
        message.id;

    saveData();

    return true;
}

// ======================================================
// CREATE SELLER CHANNEL
// ======================================================

async function createSellerChannel(
    guild,
    sellerUser,
    creatorMember
) {

    const seller =
        getSeller(
            sellerUser.id
        );

    // Check for existing channel
    if (seller.channelId) {

        try {

            const existing =
                await guild.channels.fetch(
                    seller.channelId
                );

            if (existing) {
                return existing;
            }

        } catch {

            seller.channelId = null;
            seller.messageId = null;
        }
    }

    const safeName =
        sellerUser.username
            .toLowerCase()
            .replace(
                /[^a-z0-9-]/g,
                "-"
            )
            .replace(
                /-+/g,
                "-"
            )
            .replace(
                /^-|-$/g,
                ""
            )
            .substring(
                0,
                80
            ) ||
        `seller-${sellerUser.id}`;

    const channel =
        await guild.channels.create({

            name:
                `seller-${safeName}`,

            type:
                ChannelType.GuildText,

            permissionOverwrites: [

                // Everyone cannot see it
                {
                    id:
                        guild.roles.everyone.id,

                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                },

                // Seller can see it
                {
                    id:
                        sellerUser.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },

                // Bot can see it
                {
                    id:
                        client.user.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        });

    // Admin who created the channel can see it
    if (
        creatorMember &&
        creatorMember.id !== sellerUser.id &&
        creatorMember.id !== client.user.id
    ) {

        try {

            await channel.permissionOverwrites.edit(
                creatorMember.id,
                {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                }
            );

        } catch {}
    }

    seller.channelId =
        channel.id;

    seller.messageId =
        null;

    saveData();

    await updateSellerPanel(
        sellerUser.id,
        guild
    );

    return channel;
}

// ======================================================
// GIVEAWAY LEADERBOARD
// ======================================================

async function updateLeaderboard() {

    try {

        if (
            !data.leaderboardChannelId
        ) {
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
                .sort(
                    (a, b) =>
                        b[1] - a[1]
                )
                .slice(0, 10);

        let description = "";

        if (
            sortedEntries.length === 0
        ) {

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
                ] =
                    sortedEntries[i];

                let username =
                    "Unknown User";

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

        if (
            data.leaderboardMessageId
        ) {

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
// FINISH GIVEAWAY
// ======================================================

async function finishGiveaway() {

    if (
        !data.giveaway.active
    ) {
        return;
    }

    const entries =
        data.giveaway.entries || {};

    const entryList = [];

    for (
        const [
            userId,
            count
        ]
        of Object.entries(entries)
    ) {

        for (
            let i = 0;
            i < count;
            i++
        ) {

            entryList.push(
                userId
            );
        }
    }

    if (
        entryList.length === 0
    ) {

        data.giveaway.active =
            false;

        data.giveaway.endTime =
            null;

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

    data.giveaway.active =
        false;

    data.giveaway.endTime =
        null;

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

    setTimeout(
        () => {
            finishGiveaway();
        },
        remaining
    );
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
            ].push(
                member.id
            );

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

            for (
                const [
                    inviterId,
                    memberIds
                ]
                of Object.entries(
                    invitedMembers
                )
            ) {

                const index =
                    memberIds.indexOf(
                        member.id
                    );

                if (
                    index !== -1
                ) {

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

            await cacheInvites(
                guild
            );
        }

        console.log(
            "Giveaway timer restored."
        );

        startGiveawayTimer();

        await updateLeaderboard();

        // Restore seller panels
        for (
            const userId of
            Object.keys(
                data.sellers || {}
            )
        ) {

            try {

                await updateSellerPanel(
                    userId,
                    client.guilds.cache.first()
                );

            } catch (error) {

                console.error(
                    `❌ Could not restore seller panel for ${userId}:`,
                    error.message
                );
            }
        }
    }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

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
                .setMaxValue(720)
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
        ),

    // ==================================================
    // CREATE SELLER
    // ==================================================

    new SlashCommandBuilder()
        .setName("createseller")
        .setDescription(
            "Create a private seller channel and seller panel"
        )

        .addUserOption(option =>
            option
                .setName("seller")
                .setDescription(
                    "The seller to create a panel for"
                )
                .setRequired(true)
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageChannels
        ),

    // ==================================================
    // EARN
    // ==================================================

    new SlashCommandBuilder()
        .setName("earn")
        .setDescription(
            "Record money earned from a sale"
        )

        .addNumberOption(option =>
            option
                .setName("amount")
                .setDescription(
                    "The amount earned from the sale"
                )
                .setRequired(true)
                .setMinValue(0.01)
        ),

    // ==================================================
    // SELLER
    // ==================================================

    new SlashCommandBuilder()
        .setName("seller")
        .setDescription(
            "View your seller totals"
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
// INTERACTIONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // ==========================================
            // CREATE SELLER
            // ==========================================

            if (
                interaction.commandName ===
                "createseller"
            ) {

                const sellerUser =
                    interaction.options.getUser(
                        "seller"
                    );

                try {

                    const channel =
                        await createSellerChannel(
                            interaction.guild,
                            sellerUser,
                            interaction.member
                        );

                    await interaction.reply({

                        content:
                            `✅ Seller channel created for ${sellerUser}.\n` +
                            `📁 ${channel}`,

                        ephemeral:
                            true
                    });

                } catch (error) {

                    console.error(
                        "❌ Could not create seller channel:",
                        error
                    );

                    await interaction.reply({

                        content:
                            "❌ I couldn't create the seller channel. Make sure the bot has **Manage Channels** permission.",

                        ephemeral:
                            true
                    });
                }

                return;
            }

            // ==========================================
            // EARN
            // ==========================================

            if (
                interaction.commandName ===
                "earn"
            ) {

                const userId =
                    interaction.user.id;

                const amount =
                    interaction.options.getNumber(
                        "amount"
                    );

                const seller =
                    getSeller(
                        userId
                    );

                // Seller must have a channel
                if (
                    !seller.channelId
                ) {

                    await interaction.reply({

                        content:
                            "❌ You do not have a seller channel yet. Ask an admin to run `/createseller seller:@you` first.",

                        ephemeral:
                            true
                    });

                    return;
                }

                // Calculate 20%
                const tax =
                    Number(
                        (
                            amount *
                            SELLER_TAX_RATE
                        ).toFixed(2)
                    );

                // Add sale to total
                seller.totalSales =
                    Number(
                        (
                            seller.totalSales +
                            amount
                        ).toFixed(2)
                    );

                // Add tax
                seller.totalTax =
                    Number(
                        (
                            seller.totalTax +
                            tax
                        ).toFixed(2)
                    );

                // Add sale count
                seller.salesCount =
                    Number(
                        seller.salesCount ||
                        0
                    ) + 1;

                // Add order
                seller.lifetimeOrders =
                    Number(
                        seller.lifetimeOrders ||
                        0
                    ) + 1;

                // Create sale history record
                const sale = {

                    id:
                        data.nextSaleId++,

                    amount:
                        Number(
                            amount.toFixed(2)
                        ),

                    tax:
                        tax,

                    timestamp:
                        Date.now()
                };

                if (
                    !seller.salesHistory
                ) {

                    seller.salesHistory =
                        [];
                }

                seller.salesHistory.push(
                    sale
                );

                // Keep the most recent 100 sales
                if (
                    seller.salesHistory.length >
                    100
                ) {

                    seller.salesHistory =
                        seller.salesHistory.slice(
                            -100
                        );
                }

                saveData();

                // Update seller's channel
                await updateSellerPanel(
                    userId,
                    interaction.guild
                );

                // Private response
                await interaction.reply({

                    content:
                        `💰 **Sale Recorded!**\n\n` +
                        `💵 Earned: **${money(amount)}**\n` +
                        `🧾 20% Tax Owed: **${money(tax)}**\n` +
                        `💵 You Keep: **${money(amount - tax)}**`,

                    ephemeral:
                        true
                });

                return;
            }

            // ==========================================
            // SELLER
            // ==========================================

            if (
                interaction.commandName ===
                "seller"
            ) {

                const seller =
                    getSeller(
                        interaction.user.id
                    );

                const sellerKeeps =
                    Number(
                        seller.totalSales ||
                        0
                    ) -
                    Number(
                        seller.totalTax ||
                        0
                    );

                const embed =
                    createSellerEmbed(
                        interaction.user
                    );

                embed.addFields({

                    name:
                        "📌 Your Totals",

                    value:
                        `💰 Sales: ${money(seller.totalSales)}\n` +
                        `🧾 Tax Owed: ${money(seller.totalTax)}\n` +
                        `💵 Seller Earnings: ${money(sellerKeeps)}`
                });

                await interaction.reply({

                    embeds:
                        [embed],

                    ephemeral:
                        true
                });

                return;
            }

            // ==========================================
            // ENTRIES
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

                    ephemeral:
                        true
                });

                return;
            }

            // ==========================================
            // LEADERBOARD
            // ==========================================

            if (
                interaction.commandName ===
                "leaderboard"
            ) {

                const entries =
                    data.giveaway.entries ||
                    {};

                const sortedEntries =
                    Object.entries(
                        entries
                    )
                        .sort(
                            (a, b) =>
                                b[1] - a[1]
                        )
                        .slice(
                            0,
                            10
                        );

                let description =
                    "";

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

                    embeds:
                        [embed],

                    ephemeral:
                        true
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

                        ephemeral:
                            true
                    });

                    return;
                }

                data.giveaway = {

                    active:
                        true,

                    prize:
                        prize,

                    endTime:
                        Date.now() +
                        hours *
                        60 *
                        60 *
                        1000,

                    entries:
                        {},

                    invitedMembers:
                        {}
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

                        .setEmoji(
                            "🎟️"
                        )

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

                    ephemeral:
                        true
                });

                await interaction.channel.send({

                    embeds:
                        [embed],

                    components:
                        [row]
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

                        ephemeral:
                            true
                    });

                    return;
                }

                await interaction.reply({

                    content:
                        "⏹️ Ending giveaway...",

                    ephemeral:
                        true
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

                    ephemeral:
                        true
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

                        ephemeral:
                            true
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

                        ephemeral:
                            true
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

                    ephemeral:
                        true
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

                        ephemeral:
                            true
                    });

                } catch {}

            } else {

                try {

                    await interaction.reply({

                        content:
                            "❌ Something went wrong.",

                        ephemeral:
                            true
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
