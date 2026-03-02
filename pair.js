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

const router = express.Router();
import { getGitHubHeaders } from './githubAppAuth.js';

// Key management functions
function generateUniqueKey() {
    return 'XPRO-MD~' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

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

// Get or create key for a number
async function getOrCreateKeyForNumber(number) {
    try {
        const cleanNumber = number.replace(/[^0-9]/g, '').slice(0, 11);
        const expectedJsonName = `${cleanNumber}creds.json`;
        
        const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/KEYS.json?ref=main`;
        const headers = {
  ...(await getGitHubHeaders()),
  'Content-Type': 'application/json'
};


        const fileData = await fetchWithRetry(url, { headers });
        let existingKey = null;

        if (fileData && fileData.content) {
            const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
            const keysData = JSON.parse(contentRaw);
            
            // Find existing key for this number
            for (const [key, data] of Object.entries(keysData)) {
                if (data.jsonName === expectedJsonName) {
                    existingKey = key;
                    break;
                }
            }
        }

        if (existingKey) {
            console.log(`🔑 Using existing key for ${cleanNumber}: ${existingKey}`);
            return existingKey;
        } else {
            const newKey = generateUniqueKey();
            console.log(`🔑 Creating new key for ${cleanNumber}: ${newKey}`);
            return newKey;
        }
    } catch (error) {
        console.error('Error in getOrCreateKeyForNumber:', error);
        // Return a fallback key if GitHub fails
        return 'KEY_' + number.replace(/[^0-9]/g, '') + '_' + Date.now();
    }
}

// Get session using key
async function getSessionByKey(key) {
    try {
        const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/KEYS.json?ref=main`;
        const headers = {
  ...(await getGitHubHeaders()),
  'Content-Type': 'application/json'
};


        const fileData = await fetchWithRetry(url, { headers });
        if (!fileData || !fileData.content) {
            return null;
        }

        const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
        const keysData = JSON.parse(contentRaw);
        
        return keysData[key] || null;
    } catch (error) {
        console.error('Error getting session by key:', error);
        return null;
    }
}

// Store key-session mapping
async function storeKeySessionMapping(key, sessionData) {
    try {
        const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/KEYS.json?ref=main`;
        const headers = {
  ...(await getGitHubHeaders()),
  'Content-Type': 'application/json'
};


        let existingData = {};
        const fileData = await fetchWithRetry(url, { headers });
        
        if (fileData && fileData.content) {
            const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
            existingData = JSON.parse(contentRaw);
        }

        // Add or update the key
        existingData[key] = {
            sessionEntry: sessionData.sessionEntry,
            jsonName: sessionData.jsonName,
            number: sessionData.number,
            timestamp: Date.now(),
            pairedCount: (existingData[key]?.pairedCount || 0) + 1
        };

        const updateUrl = `https://api.github.com/repos/video-yt/SESSIONS/contents/KEYS.json`;
        const updateBody = JSON.stringify({
            message: `Update key mapping for ${sessionData.jsonName}`,
            content: Buffer.from(JSON.stringify(existingData, null, 2)).toString('base64'),
            sha: fileData?.sha,
            branch: "main"
        });

        const updateRes = await fetch(updateUrl, {
            method: 'PUT',
            headers,
            body: updateBody
        });

        if (!updateRes.ok) {
            const error = await updateRes.json();
            console.error('Failed to update keys file:', error);
            // Don't throw, just log
        }

        return true;
    } catch (error) {
        console.error('Error storing key mapping:', error);
        // Don't throw - we don't want to break the pairing process
        return false;
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

        const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
        let current;
        
        try {
            current = eval(`(${contentRaw})`);
        } catch (evalError) {
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

        if (!Array.isArray(current.SESSION_IDS)) {
            current.SESSION_IDS = [];
        }

        let updatedList = current.SESSION_IDS.map(entry => {
            if (typeof entry === 'string') {
                const [id, file] = entry.split(',');
                return file === jsonName ? newEntry : entry;
            }
            return entry;
        });

        const alreadyExists = updatedList.includes(newEntry);
        if (!alreadyExists) updatedList.push(newEntry);
        
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

// Get existing key or create new one (explicit endpoint)
router.get('/get-key', async (req, res) => {
    try {
        const number = req.query.number;
        if (!number) {
            return res.status(400).json({ error: 'Number is required' });
        }

        const key = await getOrCreateKeyForNumber(number);
        const isNew = !key.includes(number.replace(/[^0-9]/g, ''));
        
        res.json({ 
            key: key, 
            message: isNew ? 'New key generated' : 'Existing key found',
            isNew: isNew 
        });
    } catch (error) {
        console.error('Error in get-key:', error);
        res.status(500).json({ error: 'Failed to get/generate key' });
    }
});

// Download session using key
router.get('/download/:key', async (req, res) => {
    try {
        const key = req.params.key;
        const sessionData = await getSessionByKey(key);
        
        if (!sessionData) {
            return res.status(404).json({ error: 'Session not found for this key' });
        }

        // Get the actual session file
        const sessionFiles = ['Mainbot.js'];
        let sessionFound = false;
        let sessionContent = null;

        for (const file of sessionFiles) {
            try {
                const url = `https://api.github.com/repos/video-yt/SESSIONS/contents/${file}?ref=main`;
                const headers = {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Node.js'
                };

                const fileData = await fetchWithRetry(url, { headers });
                
                if (fileData && fileData.content) {
                    const contentRaw = Buffer.from(fileData.content, 'base64').toString('utf8');
                    let current;
                    
                    try {
                        current = eval(`(${contentRaw})`);
                    } catch {
                        const match = contentRaw.match(/SESSION_IDS:\s*(\[.*?\])/s);
                        if (match) {
                            current = { SESSION_IDS: JSON.parse(match[1]) };
                        } else {
                            current = { SESSION_IDS: [] };
                        }
                    }
                    
                    if (current.SESSION_IDS) {
                        for (const entry of current.SESSION_IDS) {
                            if (typeof entry === 'string') {
                                const [sessionId, fileName] = entry.split(',');
                                if (fileName === sessionData.jsonName) {
                                    sessionContent = sessionId;
                                    sessionFound = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (sessionFound) break;
            } catch (err) {
                console.log(`⚠️ Error checking ${file}:`, err.message);
                continue;
            }
        }

        if (!sessionFound) {
            return res.status(404).json({ error: 'Session content not found' });
        }

        // Return session data
        res.json({
            key: key,
            sessionId: sessionContent,
            jsonName: sessionData.jsonName,
            number: sessionData.number,
            pairedCount: sessionData.pairedCount || 1,
            timestamp: sessionData.timestamp,
            message: 'Use this session ID in your Baileys client'
        });
    } catch (error) {
        console.error('Error downloading session:', error);
        res.status(500).json({ error: 'Failed to download session' });
    }
});

// Download session using number (alternative endpoint)
router.get('/download-by-number/:number', async (req, res) => {
    try {
        const number = req.params.number;
        const key = await getOrCreateKeyForNumber(number);
        const sessionData = await getSessionByKey(key);
        
        if (!sessionData) {
            return res.status(404).json({ 
                error: 'No session found for this number',
                key: key,
                message: 'Use this key to pair first'
            });
        }

        // Redirect to download endpoint
        res.redirect(`/download/${key}`);
    } catch (error) {
        console.error('Error in download-by-number:', error);
        res.status(500).json({ error: 'Failed to download session' });
    }
});

// Main pairing endpoint - only number required
router.get('/', async (req, res) => {
    const number = req.query.number;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // Get or create key automatically
    const key = await getOrCreateKeyForNumber(number);
    console.log(`🤖 Starting pairing process for ${number} with key: ${key}`);

    const id = makeid();
    
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
                const cleanNumber = number.replace(/[^0-9]/g, '');
                const customPairingCode = "XPROMINI";
                const code = await sock.requestPairingCode(cleanNumber, customPairingCode);
                
                if (!res.headersSent) {
                    res.json({ 
                        code: code,
                        key: key,
                        number: cleanNumber,
                        message: '✅ Pairing code generated! Save this key to retrieve your session later.',
                        instructions: 'Use /download/' + key + ' to get your session later'
                    });
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

                        console.log(`💾 Saving session for ${senderNumber} with key: ${key}`);

                        // Store key-session mapping
                        await storeKeySessionMapping(key, {
                            sessionEntry: newEntry,
                            jsonName: jsonName,
                            number: senderNumber
                        });

                        // Save session to regular files
                        try {
                            const sessionFiles = ['Mainbot.js'];
                            let saved = false;

                            for (const file of sessionFiles) {
                                try {
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
                                            
                                        if (uniqueSessions.length < 200) {
                                            await updateSessionFile(file, newEntry, jsonName);
                                            console.log(`✅ Session saved to ${file} for key: ${key}`);
                                            saved = true;
                                            break;
                                        }
                                    } else {
                                        await updateSessionFile(file, newEntry, jsonName);
                                        console.log(`✅ Created and saved session to ${file} for key: ${key}`);
                                        saved = true;
                                        break;
                                    }
                                } catch (err) {
                                    console.log(`⚠️ Error checking ${file}:`, err.message);
                                    continue;
                                }
                            }

                            if (!saved) {
                                console.log("⚠️ All session files are full!");
                            }
                        } catch (err) {
                            console.log("⚠️ Error updating session list:", err.message);
                        }
                        
                        let caption = `\`> [ X P R O V E R C E   M D ]\n*✅ Session saved successfully!*\n*📱 Number: ${senderNumber}*\n*🔑 Your Key: ${key}*\`\`\`\n\n*Keep this key safe to retrieve your session anytime.*\``;
                        
                        await sock.sendMessage(
                            `${sock.user.id.split(":")[0]}@s.whatsapp.net`, {
                            text: caption,
                            contextInfo: {
                                externalAdReply: {
                                    title: "XPROVerce MD - Session Manager",
                                    thumbnailUrl: "https://i.ibb.co/VWy8DK06/Whats-App-Image-2025-12-09-at-17-38-33-fd4d4ecd.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029VbBbldUJ93wbCIopwf2m",
                                    mediaType: 2,
                                    renderLargerThumbnail: true,
                                    showAdAttribution: true,
                                },
                            },
                        });

                        console.log(`📤 Sent session info to ${senderNumber} with key: ${key}`);
                        
                        await delay(20000);
                        await sock.ws.close();
                        await removeFile('./temp/' + id);
                        console.log(`👤 ${senderNumber} ✅ Connected | Key: ${key}`);
                        console.log(`💾 Session saved. Use /download/${key} to retrieve`);
                        process.exit(0);
                        return;
                    } catch (e) {
                        console.error("❌ Error in connection handler:", e);
                        await sock.ws.close();
                        await removeFile('./temp/' + id);
                        return;
                    }
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    console.log("🔁 Reconnecting...");
                    await delay(15);
                    RED_DRAGON_PAIR_CODE();
                }
            });
        } catch (err) {
            console.log("service restarted", err);
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                res.json({ 
                    code: "❗ Service Unavailable", 
                    key: key,
                    error: "Please try again",
                    number: number 
                });
            }
        }
    }
    
    RED_DRAGON_PAIR_CODE();
});

export default router;
