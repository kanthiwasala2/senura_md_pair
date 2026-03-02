import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bodyParser from 'body-parser';
import 'dotenv/config';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

const PORT = process.env.PORT || 8080;

// Import routes dynamically
async function loadRoutes() {
    const code = await import('./mini-pair.js');
    const code2 = await import('./pair.js'); // Assuming qr.js exists
    
    app.use('/numx', code.default);
    app.use('/numx2', code2.default);
}

// Route handlers
app.use('/mini-pair', async (req, res, next) => {
    res.sendFile(join(__dirname, 'mini-pair.html'));
});

app.use('/pair', async (req, res, next) => {
    res.sendFile(join(__dirname, 'pair.html'));
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Load routes and start server
loadRoutes().then(() => {
    app.listen(PORT, () => {
        console.log(`RED DRAGON Server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to load routes:', err);
});

export default app;