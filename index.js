require("dotenv").config();

const express = require("express");
const fs = require("fs");

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
    ButtonStyle
} = require("discord.js");

// ======================================================
// RENDER WEB SERVER
// ======================================================

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("Discord bot is online!");
});

app.get("/health", (req, res) => {
    res.json({
        online: true,
        bot: client?.user?.tag || null
    });
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// ======================================================
// CONFIG
// ======================================================

const DATA_FILE = "./data.json";
const TAX_RATE = 0.20;

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
        const savedData = JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );

        data = {
            giveaway: {
                active: false,
                prize: "",
                endTime: null,
                entries: {},
                invitedMembers: {},
                ...(savedData.giveaway || {})
            },

            leaderboardChannelId:
                savedData.leaderboardChannelId || null,

            leaderboardMessageId:
                savedData.leaderboardMessageId || null,

            sellers:
                savedData.sellers || {},

            nextSaleId:
                savedData.nextSaleId || 1
        };

    } catch (error) {
        console.error(
            "Could not read data.json:",
            error.message
        );
    }
}

// ======================================================
// SAVE DATA
// ======================================================

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2)
        );
    } catch (error) {
        console.error(
            "Could not save data:",
            error.message
        );
    }
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
            "Could not cache invites:",
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
            "Could not find used invite:",
            error.message
        );

        return null;
    }
}

// ======================================================
// GIVEAWAY LEADERBOARD
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
            "Could not update leaderboard:",
            error.message
        );
    }
}

// ======================================================
// FINISH GIVEAWAY
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

        for (
            let i = 0;
            i < count;
            i++
        ) {
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
            "Could not find a channel to announce giveaway winner."
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
                return;
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
                "Error handling member join:",
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
                "Error handling member leave:",
                error.message
            );
        }
    }
);

// ======================================================
// SELLER PANEL
// ======================================================

function createSellerEmbed(
    userId,
    seller
) {
    const totalSales =
        Number(seller.totalSales || 0);

    const totalTax =
        Number(seller.totalTax || 0);

    const amountAfterTax =
        totalSales - totalTax;

    return new EmbedBuilder()
        .setTitle("💰 Seller Sales")
        .setDescription(
            `<@${userId}>\n\n` +
            "Your sales information is shown below."
        )
        .addFields(
            {
                name: "💵 Total Sales",
                value:
                    `$${totalSales.toFixed(2)}`,
                inline: true
            },
            {
                name: "🧾 Tax Owed",
                value:
                    `$${totalTax.toFixed(2)}`,
                inline: true
            },
            {
                name: "💰 After Tax",
                value:
                    `$${amountAfterTax.toFixed(2)}`,
                inline: true
            },
            {
                name: "📦 Sales",
                value:
                    `${seller.salesCount || 0}`,
                inline: true
            },
            {
                name: "📋 Lifetime Orders",
                value:
                    `${seller.lifetimeOrders || 0}`,
                inline: true
            }
        )
        .setFooter({
            text: "Tax rate: 20%"
        })
        .setTimestamp();
}

// ======================================================
// UPDATE SELLER PANEL
// ======================================================

async function updateSellerPanel(
    guild,
    userId
) {
    try {
        const seller =
            data.sellers[userId];

        if (!seller) {
            return;
        }

        let channel = null;

        if (seller.channelId) {
            try {
                channel =
                    await guild.channels.fetch(
                        seller.channelId
                    );
            } catch {
                channel = null;
            }
        }

        if (!channel) {
            console.error(
                `Seller channel not found for ${userId}`
            );

            return;
        }

        const embed =
            createSellerEmbed(
                userId,
                seller
            );

        if (seller.messageId) {
            try {
                const message =
                    await channel.messages.fetch(
                        seller.messageId
                    );

                await message.edit({
                    embeds: [embed]
                });

                return;

            } catch {
                seller.messageId = null;
            }
        }

        const message =
            await channel.send({
                embeds: [embed]
            });

        seller.messageId =
            message.id;

        saveData();

    } catch (error) {
        console.error(
            "Could not update seller panel:",
            error.message
        );
    }
}

// ======================================================
// RESTORE SELLER PANELS
// ======================================================

async function restoreSellerPanels() {
    for (
        const guild of
        client.guilds.cache.values()
    ) {

        for (
            const userId of
            Object.keys(data.sellers)
        ) {

            await updateSellerPanel(
                guild,
                userId
            );
        }
    }
}

// ======================================================
// CREATE SELLER
// ======================================================

async function createSeller(
    guild,
    user
) {
    if (
        data.sellers[user.id]
    ) {
        return {
            success: false,
            message:
                "❌ This user is already a seller."
        };
    }

    const safeUsername =
        user.username
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .substring(0, 80);

    const channel =
        await guild.channels.create({
            name:
                `sales-${safeUsername}`,

            type: 0,

            permissionOverwrites: [
                {
                    id:
                        guild.roles.everyone.id,

                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                },
                {
                    id:
                        user.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id:
                        client.user.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        });

    data.sellers[user.id] = {
        channelId:
            channel.id,

        messageId:
            null,

        totalSales:
            0,

        salesCount:
            0,

        totalTax:
            0,

        lifetimeOrders:
            0,

        salesHistory:
            []
    };

    saveData();

    await updateSellerPanel(
        guild,
        user.id
    );

    return {
        success: true,
        channel
    };
}

// ======================================================
// READY
// ======================================================

client.once(
    "clientReady",
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

        await restoreSellerPanels();

        console.log(
            "Seller panels restored."
        );
    }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

    new SlashCommandBuilder()
        .setName("entries")
        .setDescription(
            "View your giveaway entries"
        ),

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(
            "View the giveaway leaderboard"
        ),

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

    new SlashCommandBuilder()
        .setName("endgiveaway")
        .setDescription(
            "End the current giveaway"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    new SlashCommandBuilder()
        .setName("setleaderboard")
        .setDescription(
            "Set this channel as the giveaway leaderboard channel"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    new SlashCommandBuilder()
        .setName("createseller")
        .setDescription(
            "Create a seller sales channel"
        )
        .addUserOption(option =>
            option
                .setName("seller")
                .setDescription(
                    "The person who should be added as a seller"
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageChannels
        ),

    new SlashCommandBuilder()
        .setName("earn")
        .setDescription(
            "Record a sale"
        )
        .addNumberOption(option =>
            option
                .setName("amount")
                .setDescription(
                    "The amount of the sale"
                )
                .setRequired(true)
                .setMinValue(0.01)
        ),

    new SlashCommandBuilder()
        .setName("seller")
        .setDescription(
            "View your seller sales information"
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
            "Could not register slash commands:",
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
            // ENTRIES
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
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
                    flags: 64
                });

                return;
            }

            // ==========================================
            // LEADERBOARD
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
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
                    flags: 64
                });

                return;
            }

            // ==========================================
            // START GIVEAWAY
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
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
                        flags: 64
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
                    flags: 64
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
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                "endgiveaway"
            ) {

                if (
                    !data.giveaway.active
                ) {

                    await interaction.reply({
                        content:
                            "❌ There is no active giveaway.",
                        flags: 64
                    });

                    return;
                }

                await interaction.reply({
                    content:
                        "⏹️ Ending giveaway...",
                    flags: 64
                });

                await finishGiveaway();

                return;
            }

            // ==========================================
            // SET LEADERBOARD
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
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
                    flags: 64
                });

                return;
            }

            // ==========================================
            // CREATE SELLER
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                "createseller"
            ) {

                const sellerUser =
                    interaction.options.getUser(
                        "seller"
                    );

                if (
                    data.sellers[
                        sellerUser.id
                    ]
                ) {

                    await interaction.reply({
                        content:
                            "❌ This user is already registered as a seller.",
                        flags: 64
                    });

                    return;
                }

                // Acknowledge the interaction immediately because creating
                // the seller channel/panel can take longer than Discord's
                // initial interaction response window.
                await interaction.deferReply({
                    flags: 64
                });

                const result =
                    await createSeller(
                        interaction.guild,
                        sellerUser
                    );

                if (!result.success) {

                    await interaction.editReply({
                        content:
                            result.message
                    });

                    return;
                }

                await interaction.editReply({
                    content:
                        `✅ Seller created for ${sellerUser}.\n\n📁 Seller channel: ${result.channel}`
                });

                return;
            }

            // ==========================================
            // EARN
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                "earn"
            ) {

                const userId =
                    interaction.user.id;

                if (
                    !data.sellers[userId]
                ) {

                    await interaction.reply({
                        content:
                            "❌ You are not registered as a seller.",
                        flags: 64
                    });

                    return;
                }

                const amount =
                    interaction.options.getNumber(
                        "amount"
                    );

                const tax =
                    Number(
                        (
                            amount *
                            TAX_RATE
                        ).toFixed(2)
                    );

                const seller =
                    data.sellers[userId];

                seller.totalSales =
                    Number(
                        seller.totalSales || 0
                    ) + amount;

                seller.totalTax =
                    Number(
                        seller.totalTax || 0
                    ) + tax;

                seller.salesCount =
                    Number(
                        seller.salesCount || 0
                    ) + 1;

                seller.lifetimeOrders =
                    Number(
                        seller.lifetimeOrders || 0
                    ) + 1;

                const sale = {
                    id:
                        data.nextSaleId++,

                    amount:
                        Number(
                            amount.toFixed(2)
                        ),

                    tax,

                    timestamp:
                        new Date().toISOString()
                };

                if (
                    !Array.isArray(
                        seller.salesHistory
                    )
                ) {
                    seller.salesHistory = [];
                }

                seller.salesHistory.push(
                    sale
                );

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

                await updateSellerPanel(
                    interaction.guild,
                    userId
                );

                const afterTax =
                    amount - tax;

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "💰 Sale Recorded"
                        )
                        .addFields(
                            {
                                name:
                                    "Sale",
                                value:
                                    `$${amount.toFixed(2)}`,
                                inline:
                                    true
                            },
                            {
                                name:
                                    "Tax (20%)",
                                value:
                                    `$${tax.toFixed(2)}`,
                                inline:
                                    true
                            },
                            {
                                name:
                                    "After Tax",
                                value:
                                    `$${afterTax.toFixed(2)}`,
                                inline:
                                    true
                            }
                        )
                        .setTimestamp();

                await interaction.reply({
                    embeds: [embed],
                    flags: 64
                });

                return;
            }

            // ==========================================
            // SELLER
            // ==========================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                "seller"
            ) {

                const userId =
                    interaction.user.id;

                const seller =
                    data.sellers[userId];

                if (!seller) {

                    await interaction.reply({
                        content:
                            "❌ You are not registered as a seller.",
                        flags: 64
                    });

                    return;
                }

                const embed =
                    createSellerEmbed(
                        userId,
                        seller
                    );

                await interaction.reply({
                    embeds: [embed],
                    flags: 64
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
                        flags: 64
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
                        flags: 64
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
                    flags: 64
                });

                await updateLeaderboard();

                return;
            }

        } catch (error) {

            console.error(
                "Interaction error:",
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
                        flags: 64
                    });

                } catch {}

            } else {

                try {

                    await interaction.reply({
                        content:
                            "❌ Something went wrong.",
                        flags: 64
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