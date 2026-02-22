const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();

// Get run mode from env file
const runMode = process.env.RUN_MODE || 'local';

let API_KEY;

if (runMode === 'local') {
    API_KEY = process.env.RUGPLAY_API_KEY;
    console.log('Loaded API Key:', API_KEY || 'No API key found');
} else {
    console.log('Running on deployed mode, not fetching API key from env.');
}

// Use environment variable for port, or default to 3000
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));
console.log('Serving static files from:', path.join(__dirname, '../public'));
app.use(express.json({ limit: '50mb' }));

console.log('Run mode:', runMode);

app.get('/', (req, res) => {
    res.redirect('/homepage/homepage.html');
});

app.use('/homepage', express.static(path.join(__dirname, '../public/homepage')));
app.use('/coinpage', express.static(path.join(__dirname, '../public/coinpage')));
app.use('/search', express.static(path.join(__dirname, '../public/search')));
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));
app.use('/global', express.static(path.join(__dirname, '../public/global')));

// ============== Helper Functions ==============

/**
 * Get authorization header based on run mode
 */
function getAuthHeaders(req) {
    const authToken = runMode === 'local' ? API_KEY : req.query.apikey;
    const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
    };

    if (runMode !== 'local') {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
        headers['Accept'] = 'application/json, text/plain, */*';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Accept-Encoding'] = 'gzip, deflate, br';
        headers['Connection'] = 'keep-alive';
        headers['Pragma'] = 'no-cache';
        headers['Cache-Control'] = 'no-cache';
    }

    return headers;
}

/**
 * Generic API fetch handler
 */
async function handleApiRequest(url, req, res) {
    try {
        console.log('Fetching from URL:', url);

        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders(req)
        });

        console.log('External API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', errorText);
            return res.status(response.status).json({
                error: 'Failed to fetch data from external API.',
                details: errorText
            });
        }

        const data = await response.json();
        console.log('Successfully fetched data:', data);
        res.json(data);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
}

// ============== API Routes ==============

// Top coins endpoint
app.get('/api/top-coins', (req, res) => {
    if (runMode !== 'local') {
        console.log('API key from request query:', req.query.apikey);
    }
    handleApiRequest('https://rugplay.com/api/v1/top', req, res);
});

// Market data endpoint
app.get('/api/market-data', (req, res) => {
    const params = {
        search: req.query.search,
        sortBy: req.query.sortBy,
        sortOrder: req.query.sortOrder,
        priceFilter: req.query.priceFilter,
        changeFilter: req.query.changeFilter,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 12
    };

    const url = new URL('https://rugplay.com/api/v1/market');
    url.search = new URLSearchParams(params).toString();

    handleApiRequest(url, req, res);
});

// Coin info endpoint
app.get('/api/coin-info', (req, res) => {
    const params = {
        timeframe: req.query.timeframe || '1m'
    };

    const url = new URL(`https://rugplay.com/api/v1/coin/${req.query.symbol}`);
    url.search = new URLSearchParams(params).toString();

    handleApiRequest(url, req, res);
});

// Coin holders endpoint
app.get('/api/coin-holders', (req, res) => {
    const params = {
        limit: req.query.limit || 50
    };

    const url = new URL(`https://rugplay.com/api/v1/holders/${req.query.symbol}`);
    url.search = new URLSearchParams(params).toString();

    handleApiRequest(url, req, res);
});

app.post('/api/graph', (req, res) => {
    console.log('Request body:', req.body);
    const { coin, candlestickData, volumeData, timeframe } = req.body;
    const dataToSend = JSON.stringify(req.body);

    const pythonScriptPath = path.join(__dirname, 'graph_generation', 'coingraph_generator.py');

    const pythonProcess = spawn('python', [pythonScriptPath]);
    pythonProcess.stdin.write(dataToSend);
    pythonProcess.stdin.end();

    let pythonOutput = '';

    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            try {
                const graphData = JSON.parse(pythonOutput);
                console.log('Returning graph data:', graphData);
                res.json({ success: true, graphData });
            } catch (e) {
                console.error("Failed to parse JSON from Python script:", e);
                res.status(500).json({ success: false, error: 'Failed to process graph data' });
            }
        } else {
            console.error(`Python script exited with code ${code}`);
            res.status(500).json({ success: false, error: 'Graph generation failed' });
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});