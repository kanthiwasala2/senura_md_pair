import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bodyParser from 'body-parser';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware මුලින්ම තිබිය යුතුයි
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// HTML Routes
app.use('/mini-pair', (req, res) => res.sendFile(join(__dirname, 'mini-pair.html')));
app.use('/pair', (req, res) => res.sendFile(join(__dirname, 'pair.html')));

// Default route එකක් (Site එකට ගිය ගමන් පෙනෙන්න)
app.get('/', (req, res) => res.redirect('/pair'));

async function loadRoutes() {
    const code = await import('./mini-pair.js');
    const code2 = await import('./pair.js');
    app.use('/numx', code.default);
    app.use('/numx2', code2.default);
}

loadRoutes().then(() => {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
