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
    ButtonStyle
} = require("discord.js");

const fs = require("fs");

// =====================================================
// BOT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// =====================================================
// DATA
// =====================================================

const DATA_FILE = "./data.json";

const defaultData = {
    entries: {},
    invitedBy: {},
    participants: {},

    giveaway: {
        active: false,
        prize: null,
        channelId: null,
        messageId: null,
        endTime: null
    },

    leaderboard: {
        channelId: null,
        messageId: null
    }
};

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultData, null, 2)
    );
}

let data;

try {
    data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
    );
} catch {
    data = defaultData;
}

if (!data.entries) {
    data.entries = {};
}

if (!data.invitedBy) {
    data.invitedBy = {};
}

if (!data.participants) {
    data.participants = {};
}

if (!data.giveaway) {
    data.giveaway = {
        active: false,
        prize: null,
        channelId: null,
        messageId: null,
        endTime: null
    };
}

if (!data.leaderboard) {
    data.leaderboard = {
        channelId: null,
        messageId: null
    };
}

function saveData() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(data, null, 2)
    );
}

// =====================================================
// INVITE CACHE
// =====================================================

const inviteCache = new Map();

async function cacheInvites(guild) {

    try {

        const invites =
            await guild.invites.fetch();

        const inviteUses = new Map();

        invites.forEach(invite => {

            inviteUses.set(
                invite.code,
                invite.uses || 0
            );

        });

        inviteCache.set(
            guild.id,
            inviteUses
        );

        console.log(
            `✅ Cached invites for ${guild.name}`
        );

    } catch (error) {

        console.error(
            `❌ Could not cache invites for ${guild.name}:`,
            error.message
        );
    }
}

// =====================================================
// FIND USED INVITE
// =====================================================

async function findUsedInvite(guild) {

    try {

        const oldInvites =
            inviteCache.get(guild.id) ||
            new Map();

        const newInvites =
            await guild.invites.fetch();

        let usedInvite = null;

        newInvites.forEach(invite => {

            const oldUses =
                oldInvites.get(invite.code) || 0;

            const newUses =
                invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite = invite;
            }

        });

        const updatedCache = new Map();

        newInvites.forEach(invite => {

            updatedCache.set(
                invite.code,
                invite.uses || 0
            );

        });

        inviteCache.set(
            guild.id,
            updatedCache
        );

        return usedInvite;

    } catch (error) {

        console.error(
            "❌ Could not determine invite:",
            error.message
        );

        return null;
    }
}

// =====================================================
// LIVE LEADERBOARD
// =====================================================

async function updateLiveLeaderboard(guild) {

    if (!guild) {
        return;
    }

    if (!data.leaderboard.channelId) {
        return;
    }

    const channel =
        guild.channels.cache.get(
            data.leaderboard.channelId
        );

    if (!channel) {

        console.log(
            "⚠️ Leaderboard channel could not be found."
        );

        return;
    }

    let description = "";

    if (!data.giveaway.active) {

        description =
            "❌ There is currently no active giveaway.\n\n" +
            "Use `/startgiveaway` to start one.";

    } else {

        const sorted =
            Object.entries(data.entries)
                .filter(
                    ([userId]) =>
                        data.participants[userId]
                )
                .sort(
                    (a, b) => b[1] - a[1]
                )
                .slice(0, 10);

        if (sorted.length === 0) {

            description =
                "🎟️ **Nobody has entered yet!**\n\n" +
                "Click the **Enter Giveaway** button to participate.";

        } else {

            sorted.forEach(
                ([userId, entries], index) => {

                    let position;

                    if (index === 0) {
                        position = "🥇";
                    } else if (index === 1) {
                        position = "🥈";
                    } else if (index === 2) {
                        position = "🥉";
                    } else {
                        position =
                            `**${index + 1}.**`;
                    }

                    const entryWord =
                        entries === 1
                            ? "entry"
                            : "entries";

                    description +=
                        `${position} <@${userId}> — **${entries} ${entryWord}**\n`;
                }
            );
        }
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                "🏆 LIVE GIVEAWAY LEADERBOARD"
            )
            .setDescription(
                description
            )
            .setFooter({
                text:
                    "More entries = more chances to win!"
            })
            .setTimestamp();

    if (
        data.giveaway.active &&
        data.giveaway.prize
    ) {

        embed.addFields({
            name: "🎁 Prize",
            value:
                data.giveaway.prize,
            inline: true
        });

        if (data.giveaway.endTime) {

            embed.addFields({
                name: "⏰ Ends",
                value:
                    `<t:${Math.floor(
                        data.giveaway.endTime / 1000
                    )}:R>`,
                inline: true
            });
        }
    }

    try {

        let message = null;

        if (data.leaderboard.messageId) {

            try {

                message =
                    await channel.messages.fetch(
                        data.leaderboard.messageId
                    );

            } catch {

                message = null;
            }
        }

        if (message) {

            await message.edit({
                embeds: [embed]
            });

        } else {

            message =
                await channel.send({
                    embeds: [embed]
                });

            data.leaderboard.messageId =
                message.id;

            saveData();
        }

    } catch (error) {

        console.error(
            "❌ Could not update leaderboard:",
            error.message
        );
    }
}

// =====================================================
// FINISH GIVEAWAY - WEIGHTED RANDOM
// =====================================================

async function finishGiveaway() {

    if (
        !data.giveaway ||
        !data.giveaway.active
    ) {
        return;
    }

    const guild =
        client.guilds.cache.get(
            process.env.GUILD_ID
        );

    if (!guild) {

        console.error(
            "❌ Could not find the server."
        );

        return;
    }

    const giveawayChannel =
        guild.channels.cache.get(
            data.giveaway.channelId
        );

    const prize =
        data.giveaway.prize;

    // =================================================
    // CREATE RANDOM ENTRY POOL
    // =================================================

    const entryPool = [];

    Object.entries(data.entries)
        .forEach(([userId, entries]) => {

            if (
                !data.participants[userId]
            ) {
                return;
            }

            for (
                let i = 0;
                i < entries;
                i++
            ) {

                entryPool.push(userId);
            }
        });

    // End giveaway

    data.giveaway.active = false;

    saveData();

    // Update leaderboard

    await updateLiveLeaderboard(guild);

    // =================================================
    // NOBODY ENTERED
    // =================================================

    if (entryPool.length === 0) {

        if (giveawayChannel) {

            await giveawayChannel.send(
                `🏁 **GIVEAWAY ENDED!**\n\n` +
                `🎁 **Prize:** ${prize}\n\n` +
                `Nobody entered the giveaway.`
            ).catch(error => {

                console.error(
                    "❌ Could not send ending message:",
                    error.message
                );

            });
        }

        return;
    }

    // =================================================
    // RANDOM WINNER
    // =================================================

    const randomIndex =
        Math.floor(
            Math.random() *
            entryPool.length
        );

    const winnerId =
        entryPool[randomIndex];

    const winnerEntries =
        data.entries[winnerId] || 0;

    // =================================================
    // ANNOUNCE WINNER
    // =================================================

    if (giveawayChannel) {

        await giveawayChannel.send(
            `🎉🎉 **GIVEAWAY WINNER!** 🎉🎉\n\n` +
            `🎁 **Prize:** ${prize}\n\n` +
            `🏆 Congratulations <@${winnerId}>!\n\n` +
            `🎲 The winner was randomly selected from **${entryPool.length} total entries**!\n\n` +
            `<@${winnerId}> had **${winnerEntries} entries**, giving them ${winnerEntries} chance${winnerEntries === 1 ? "" : "s"} in the drawing! 🥳`
        ).catch(error => {

            console.error(
                "❌ Could not send winner message:",
                error.message
            );

        });
    }

    console.log(
        `🎲 Random giveaway winner: ${winnerId}`
    );
}

// =====================================================
// BOT READY
// =====================================================

client.once("ready", async () => {

    console.log(
        `✅ Logged in as ${client.user.tag}`
    );

    for (
        const guild of client.guilds.cache.values()
    ) {

        await cacheInvites(guild);
    }

    // Restore giveaway timer

    if (
        data.giveaway.active &&
        data.giveaway.endTime
    ) {

        const remaining =
            data.giveaway.endTime -
            Date.now();

        if (remaining <= 0) {

            await finishGiveaway();

        } else {

            setTimeout(
                finishGiveaway,
                remaining
            );

            console.log(
                "⏰ Giveaway timer restored."
            );
        }
    }

    // Update leaderboard

    const guild =
        client.guilds.cache.get(
            process.env.GUILD_ID
        );

    if (guild) {

        await updateLiveLeaderboard(
            guild
        );
    }
});

// =====================================================
// MEMBER JOINS
// =====================================================

client.on(
    "guildMemberAdd",
    async member => {

        console.log(
            `👋 ${member.user.tag} joined ${member.guild.name}`
        );

        const invite =
            await findUsedInvite(
                member.guild
            );

        if (!invite) {

            console.log(
                "⚠️ Could not determine which invite was used."
            );

            return;
        }

        if (!invite.inviter) {
            return;
        }

        const inviterId =
            invite.inviter.id;

        // Don't count the same member twice

        if (data.invitedBy[member.id]) {
            return;
        }

        // Remember who invited this member

        data.invitedBy[member.id] =
            inviterId;

        // Giveaway isn't active

        if (!data.giveaway.active) {

            saveData();

            return;
        }

        // Inviter hasn't entered

        if (
            !data.participants[inviterId]
        ) {

            console.log(
                `ℹ️ ${invite.inviter.tag} has not entered the giveaway.`
            );

            saveData();

            return;
        }

        // =================================================
        // +1 ENTRY
        // =================================================

        if (!data.entries[inviterId]) {
            data.entries[inviterId] = 0;
        }

        data.entries[inviterId]++;

        saveData();

        console.log(
            `🎟️ ${invite.inviter.tag} earned +1 entry!`
        );

        console.log(
            `📊 Total entries: ${data.entries[inviterId]}`
        );

        // Update leaderboard

        await updateLiveLeaderboard(
            member.guild
        );

        // Optional announcement

        const giveawayChannel =
            member.guild.channels.cache.get(
                data.giveaway.channelId
            );

        if (giveawayChannel) {

            await giveawayChannel.send(
                `🎉 ${invite.inviter} invited ${member.user} and earned **+1 entry!**`
            ).catch(() => {});
        }
    }
);

// =====================================================
// MEMBER LEAVES
// =====================================================

client.on(
    "guildMemberRemove",
    async member => {

        const inviterId =
            data.invitedBy[member.id];

        if (!inviterId) {
            return;
        }

        if (
            data.giveaway.active &&
            data.participants[inviterId] &&
            data.entries[inviterId] > 0
        ) {

            data.entries[inviterId]--;

            console.log(
                `➖ ${inviterId} lost 1 entry because their invited member left.`
            );
        }

        delete data.invitedBy[member.id];

        saveData();

        await updateLiveLeaderboard(
            member.guild
        );
    }
);

// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [

    // /entries

    new SlashCommandBuilder()
        .setName("entries")
        .setDescription(
            "Check your giveaway entries"
        ),

    // /leaderboard

    new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(
            "Check the giveaway leaderboard"
        ),

    // /startgiveaway

    new SlashCommandBuilder()
        .setName("startgiveaway")
        .setDescription(
            "Start an invite giveaway"
        )
        .addStringOption(option =>
            option
                .setName("prize")
                .setDescription(
                    "What is the prize?"
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("hours")
                .setDescription(
                    "How many hours should it last?"
                )
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(720)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    // /endgiveaway

    new SlashCommandBuilder()
        .setName("endgiveaway")
        .setDescription(
            "End the current giveaway"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    // /setleaderboard

    new SlashCommandBuilder()
        .setName("setleaderboard")
        .setDescription(
            "Set this channel as the live leaderboard"
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )

].map(command => command.toJSON());

// =====================================================
// REGISTER COMMANDS
// =====================================================

const rest =
    new REST({
        version: "10"
    }).setToken(
        process.env.DISCORD_TOKEN
    );

async function registerCommands() {

    try {

        console.log(
            "Registering slash commands..."
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
            "✅ Slash commands registered!"
        );

    } catch (error) {

        console.error(
            "❌ Command registration error:",
            error
        );
    }
}

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
    "interactionCreate",
    async interaction => {

        // =================================================
        // ENTER GIVEAWAY BUTTON
        // =================================================

        if (
            interaction.isButton() &&
            interaction.customId ===
            "enter_giveaway"
        ) {

            if (!data.giveaway.active) {

                await interaction.reply({
                    content:
                        "❌ There isn't an active giveaway right now.",
                    ephemeral: true
                });

                return;
            }

            const userId =
                interaction.user.id;

            // Already entered

            if (
                data.participants[userId]
            ) {

                await interaction.reply({
                    content:
                        "✅ You're already entered in the giveaway!",
                    ephemeral: true
                });

                return;
            }

            // Add participant

            data.participants[userId] =
                true;

            // Everyone starts with 1 entry

            data.entries[userId] = 1;

            saveData();

            await interaction.reply({
                content:
                    "🎉 You're entered in the giveaway!\n\n" +
                    "You currently have **1 entry**.\n\n" +
                    "Invite people to the server to earn more entries and increase your chances of winning!",
                ephemeral: true
            });

            // Update leaderboard

            await updateLiveLeaderboard(
                interaction.guild
            );

            console.log(
                `✅ ${interaction.user.tag} entered the giveaway.`
            );

            return;
        }

        // =================================================
        // SLASH COMMAND CHECK
        // =================================================

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        // =================================================
        // /ENTRIES
        // =================================================

        if (
            interaction.commandName ===
            "entries"
        ) {

            if (!data.giveaway.active) {

                await interaction.reply({
                    content:
                        "❌ There isn't currently an active giveaway.",
                    ephemeral: true
                });

                return;
            }

            const userId =
                interaction.user.id;

            if (
                !data.participants[userId]
            ) {

                await interaction.reply({
                    content:
                        "❌ You haven't entered the giveaway yet.\n\nClick **Enter Giveaway** on the giveaway message first.",
                    ephemeral: true
                });

                return;
            }

            const entries =
                data.entries[userId] || 1;

            const entryWord =
                entries === 1
                    ? "entry"
                    : "entries";

            await interaction.reply({
                content:
                    `🎟️ You currently have **${entries} ${entryWord}!**\n\n` +
                    `🎲 More entries = more chances to win!`,
                ephemeral: true
            });

            return;
        }

        // =================================================
        // /LEADERBOARD
        // =================================================

        if (
            interaction.commandName ===
            "leaderboard"
        ) {

            if (!data.giveaway.active) {

                await interaction.reply({
                    content:
                        "❌ There isn't currently an active giveaway.",
                    ephemeral: true
                });

                return;
            }

            const sorted =
                Object.entries(
                    data.entries
                )
                    .filter(
                        ([userId]) =>
                            data.participants[
                                userId
                            ]
                    )
                    .sort(
                        (a, b) =>
                            b[1] - a[1]
                    )
                    .slice(0, 10);

            if (sorted.length === 0) {

                await interaction.reply({
                    content:
                        "🏆 Nobody has entered the giveaway yet!",
                    ephemeral: true
                });

                return;
            }

            let message =
                "🏆 **GIVEAWAY LEADERBOARD** 🏆\n\n";

            sorted.forEach(
                ([userId, entries], index) => {

                    let position;

                    if (index === 0) {
                        position = "🥇";
                    } else if (index === 1) {
                        position = "🥈";
                    } else if (index === 2) {
                        position = "🥉";
                    } else {
                        position =
                            `**${index + 1}.**`;
                    }

                    message +=
                        `${position} <@${userId}> — **${entries} entries**\n`;
                }
            );

            message +=
                "\n🎲 **Remember:** The winner is randomly selected. More entries give you more chances to win!";

            await interaction.reply({
                content: message,
                ephemeral: true
            });

            return;
        }

        // =================================================
        // /STARTGIVEAWAY
        // =================================================

        if (
            interaction.commandName ===
            "startgiveaway"
        ) {

            if (
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                )
            ) {

                await interaction.reply({
                    content:
                        "❌ You need Manage Server permission.",
                    ephemeral: true
                });

                return;
            }

            if (data.giveaway.active) {

                await interaction.reply({
                    content:
                        "❌ There is already an active giveaway.",
                    ephemeral: true
                });

                return;
            }

            const prize =
                interaction.options.getString(
                    "prize"
                );

            const hours =
                interaction.options.getInteger(
                    "hours"
                );

            const endTime =
                Date.now() +
                hours *
                60 *
                60 *
                1000;

            // Reset giveaway

            data.entries = {};
            data.participants = {};
            data.invitedBy = {};

            data.giveaway = {
                active: true,
                prize: prize,
                channelId:
                    interaction.channelId,
                messageId: null,
                endTime: endTime
            };

            saveData();

            // Update leaderboard

            await updateLiveLeaderboard(
                interaction.guild
            );

            const endTimestamp =
                Math.floor(
                    endTime / 1000
                );

            // =================================================
            // GIVEAWAY EMBED
            // =================================================

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        "🎉 INVITE GIVEAWAY 🎉"
                    )
                    .setDescription(

                        `🎁 **Prize:** ${prize}\n\n` +

                        `🎟️ **Click the button below to enter!**\n\n` +

                        `🎲 **How the winner is chosen:**\n` +
                        `The winner is selected **randomly** from all entries!\n\n` +

                        `🎟️ Everyone who enters starts with **1 entry**.\n\n` +

                        `👥 Every person who joins through your invite gives you **+1 entry**.\n\n` +

                        `🚪 If someone you invited leaves the server, that entry is **removed**.\n\n` +

                        `⭐ **More entries = more chances to win!**\n\n` +

                        `⏰ **Ends:** <t:${endTimestamp}:F>\n` +
                        `⏳ **Time remaining:** <t:${endTimestamp}:R>\n\n` +

                        `Use **/entries** to check your entries.`
                    )
                    .setTimestamp();

            // =================================================
            // ENTER BUTTON
            // =================================================

            const enterButton =
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
                        enterButton
                    );

            // =================================================
            // SEND GIVEAWAY
            // =================================================

            const message =
                await interaction.reply({
                    embeds: [embed],
                    components: [row],
                    fetchReply: true
                });

            data.giveaway.messageId =
                message.id;

            saveData();

            // =================================================
            // TIMER
            // =================================================

            setTimeout(
                finishGiveaway,
                hours *
                60 *
                60 *
                1000
            );

            console.log(
                `🎉 Giveaway started: ${prize} for ${hours} hours.`
            );

            return;
        }

        // =================================================
        // /ENDGIVEAWAY
        // =================================================

        if (
            interaction.commandName ===
            "endgiveaway"
        ) {

            if (
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                )
            ) {

                await interaction.reply({
                    content:
                        "❌ You need Manage Server permission.",
                    ephemeral: true
                });

                return;
            }

            if (!data.giveaway.active) {

                await interaction.reply({
                    content:
                        "❌ There isn't an active giveaway.",
                    ephemeral: true
                });

                return;
            }

            await interaction.reply({
                content:
                    "🏁 Ending the giveaway..."
            });

            await finishGiveaway();

            return;
        }

        // =================================================
        // /SETLEADERBOARD
        // =================================================

        if (
            interaction.commandName ===
            "setleaderboard"
        ) {

            if (
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                )
            ) {

                await interaction.reply({
                    content:
                        "❌ You need Manage Server permission.",
                    ephemeral: true
                });

                return;
            }

            data.leaderboard.channelId =
                interaction.channelId;

            data.leaderboard.messageId =
                null;

            saveData();

            await interaction.reply({
                content:
                    "✅ This channel is now the live giveaway leaderboard channel!",
                ephemeral: true
            });

            await updateLiveLeaderboard(
                interaction.guild
            );

            return;
        }
    }
);

// =====================================================
// START BOT
// =====================================================

registerCommands();

client.login(
    process.env.DISCORD_TOKEN
);