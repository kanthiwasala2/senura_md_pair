import { makeid } from './gen-id.js';
import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
const MAX_SESSIONS_PER_FILE = 150;
const router = express.Router();
import { getGitHubHeaders } from './githubAppAuth.js';

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 404) {
                    // File doesn't exist, return null
                    return null;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await delay(1000 * (i + 1));
        }
    }
}

async function updateSessionFile(filePath, newEntry, jsonName) {
    try {
        const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/${filePath}?ref=main`;
        const headers = {
  ...(await getGitHubHeaders()),
  'Content-Type': 'application/json'
};


        const fileData = await fetchWithRetry(url, { headers });
        
        // If file doesn't exist, create it
        if (!fileData) {
            const createUrl = `https://api.github.com/repos/video-yt/SESSIONS/contents/${filePath}`;
            const initialContent = `module.exports = {\n  SESSION_IDS: ${JSON.stringify([newEntry], null, 2)}\n};\n`;
            
            const createBody = JSON.stringify({
                message: `Create session file for ${jsonName}`,
                content: Buffer.from(initialContent).toString('base64'),
                branch: "main"
            });

            const createRes = await fetch(createUrl, {
                method: 'PUT',
                headers,
                body: createBody
            });
            
            if (!createRes.ok) {
                const error = await createRes.json();
                throw new Error(error.message || 'Failed to create file');
            }
            
            return true;
        }

        // Check if content exists and is valid
        if (!fileData.content) {
            throw new Error('File content is undefined');
        }

        const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
        let current;
        
        try {
            // Safely evaluate the module export
            current = eval(`(${contentRaw})`);
        } catch (evalError) {
            // If eval fails, try to parse as JSON or create new structure
            console.log('Failed to eval content, attempting to parse...');
            try {
                const match = contentRaw.match(/SESSION_IDS:\s*(\[.*?\])/s);
                if (match) {
                    current = { SESSION_IDS: JSON.parse(match[1]) };
                } else {
                    current = { SESSION_IDS: [] };
                }
            } catch {
                current = { SESSION_IDS: [] };
            }
        }

        // Ensure SESSION_IDS is an array
        if (!Array.isArray(current.SESSION_IDS)) {
            current.SESSION_IDS = [];
        }

        // Update the session list
        let updatedList = current.SESSION_IDS.map(entry => {
            if (typeof entry === 'string') {
                const [id, file] = entry.split(',');
                return file === jsonName ? newEntry : entry;
            }
            return entry;
        });

        const alreadyExists = updatedList.includes(newEntry);
        if (!alreadyExists) updatedList.push(newEntry);
        
        // Remove duplicates
        updatedList = [...new Set(updatedList)];

        const newContent = `module.exports = {\n  SESSION_IDS: ${JSON.stringify(updatedList, null, 2)}\n};\n`;

        const updateUrl = `https://api.github.com/repos/video-yt/SESSIONS/contents/${filePath}`;
        const updateBody = JSON.stringify({
            message: `Update session ID for ${jsonName}`,
            content: Buffer.from(newContent).toString('base64'),
            sha: fileData.sha,
            branch: "main"
        });

const updateRes = await fetch(updateUrl, {
  method: 'PUT',
  headers,
  body: updateBody
});

if (!updateRes.ok) {
  // 🔁 GitHub App concurrency fix
  if (updateRes.status === 409) {
    console.log('🔁 GitHub SHA conflict, retrying once...');

    // refetch latest file + sha
    const fresh = await fetchWithRetry(url, { headers });
    if (!fresh || !fresh.sha) {
      throw new Error('Failed to refetch file after conflict');
    }

    const retryBody = JSON.stringify({
      message: `Retry update session ID for ${jsonName}`,
      content: Buffer.from(newContent).toString('base64'),
      sha: fresh.sha,
      branch: "main"
    });

    const retryRes = await fetch(updateUrl, {
      method: 'PUT',
      headers,
      body: retryBody
    });

    if (!retryRes.ok) {
      const e = await retryRes.text();
      throw new Error('Retry failed: ' + e);
    }

    return true;
  }

  const error = await updateRes.text();
  throw new Error(error);
}
        return true;
    } catch (error) {
        console.error('Error updating session file:', error.message);
        throw error;
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function RED_DRAGON_PAIR_CODE() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState('./temp/' + id);
        
        try {
            const items = ["Safari"];
            function selectRandomItem(array) {
                const randomIndex = Math.floor(Math.random() * array.length);
                return array[randomIndex];
            }
            const randomItem = selectRandomItem(items);
            
            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                generateHighQualityLinkPreview: true,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                syncFullHistory: false,
                browser: Browsers.macOS(randomItem)
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const customPairingCode = "XPROMINI";
                const code = await sock.requestPairingCode(num, customPairingCode);
                
                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);
            sock.ev.on("connection.update", async (s) => {
                const {
                    connection,
                    lastDisconnect
                } = s;
                
                if (connection == "open") {
                    await delay(5000);
                    let jdata = fs.readFileSync(`./temp/${id}/creds.json`);
                    let ssid = Buffer.from(jdata).toString('base64');
                    
                    try {
                        const senderNumber = sock.user.id.replace(/[^0-9]/g, '').slice(0, 11);
                        const jsonName = `${senderNumber}creds.json`;
                        const newEntry = `${ssid},${jsonName}`;

                        // Try to save session to GitHub
                        try {
                            const sessionFiles = ['fullpp.js','fullpp2.js','fullpp3.js','fullpp4.js'];
                            let saved = false;

                            for (const file of sessionFiles) {
                                try {
                                    // Check current sessions count
                                    const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/${file}?ref=main`;
                                    const headers = {
  ...(await getGitHubHeaders()),
  'Content-Type': 'application/json'
};
                                    const fileData = await fetchWithRetry(url, { headers });
                                    
                                    if (fileData && fileData.content) {
                                        const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
                                        let current;
                                        
                                        try {
                                            current = eval(`(${contentRaw})`);
                                        } catch {
                                            // Try to extract SESSION_IDS from content
                                            const match = contentRaw.match(/SESSION_IDS:\s*(\[.*?\])/s);
                                            if (match) {
                                                current = { SESSION_IDS: JSON.parse(match[1]) };
                                            } else {
                                                current = { SESSION_IDS: [] };
                                            }
                                        }
                                        
                                        const uniqueSessions = current.SESSION_IDS 
                                            ? [...new Set(current.SESSION_IDS.map(e => {
                                                if (typeof e === 'string') {
                                                    const parts = e.split(',');
                                                    return parts.length > 1 ? parts[1] : null;
                                                }
                                                return null;
                                            }).filter(Boolean))]
                                            : [];
                                            
                                        const sessionCount = Array.isArray(current.SESSION_IDS)
  ? current.SESSION_IDS.length
  : 0;

if (sessionCount >= MAX_SESSIONS_PER_FILE) {
  console.log(`⏭️ ${file} full (${sessionCount}/${MAX_SESSIONS_PER_FILE})`);
  continue;
}

await updateSessionFile(file, newEntry, jsonName);
console.log(`✅ Session saved to ${file} (${sessionCount + 1}/${MAX_SESSIONS_PER_FILE})`);
saved = true;
break;

                                    } else {
                                        // File doesn't exist or is empty, create it
                                        await updateSessionFile(file, newEntry, jsonName);
                                        console.log(`✅ Created and saved session to ${file}`);
                                        saved = true;
                                        break;
                                    }
                                } catch (err) {
                                    console.log(`⚠️ Error checking ${file}:`, err.message);
                                    continue;
                                }
                            }

                            if (!saved) {
                                console.log("⚠️ All session files are full or there was an error!");
                            }
                        } catch (err) {
                            console.log("⚠️ Error updating session list:", err.message);
                        }
                        
                        let caption = "`> [ X P R O V E R C E   M I N I ]\n*✅ Session saved to Database!*\n*Bot will start automatically on the main server.*`";
                        
                        await sock.sendMessage(
                            `${sock.user.id.split(":")[0]}@s.whatsapp.net`, {
                            text: caption,
                            contextInfo: {
                                externalAdReply: {
                                    title: "XPROVerce MD - Session",
                                    thumbnailUrl: "https://i.ibb.co/VWy8DK06/Whats-App-Image-2025-12-09-at-17-38-33-fd4d4ecd.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029VbBbldUJ93wbCIopwf2m",
                                    mediaType: 2,
                                    renderLargerThumbnail: true,
                                    showAdAttribution: true,
                                },
                            },
                        });

                        //await sock.newsletterFollow("120363420375356804@newsletter");
                        
                        await delay(20000);
                        await sock.ws.close();
                        await removeFile('./temp/' + id);
                        console.log(`👤 ${sock.user.id} 𝗖𝗼𝗻𝗻𝗲𝗰𝘁𝗲𝗱 ✅ 𝗥𝗲𝘀𝘁𝗮𝗿𝘁𝗶𝗻𝗴 𝗽𝗿𝗼𝗰𝗲𝘀𝘀...`);
                        await delay(20);
                        process.exit(0);
                        return;
                    } catch (e) {
                        console.error("❌ Error in connection handler:", e);
                        await sock.ws.close();
                        await removeFile('./temp/' + id);
                        return;
                    }
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(15);
                    RED_DRAGON_PAIR_CODE();
                }
            });
        } catch (err) {
            console.log("service restarted", err);
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                res.send({ code: "❗ Service Unavailable" });
            }
        }
    }
    
    RED_DRAGON_PAIR_CODE();
});

export default router;
