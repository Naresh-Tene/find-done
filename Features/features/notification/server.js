const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/send-blood-sms', async (req, res) => {
    const { phone, message } = req.body;
    try {
        const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
            route: 'q', // Use 'q' for Quick SMS; use 'v3' for DLT
            sender_id: 'FSTSMS',
            message: message,
            language: 'english',
            flash: 0,
            numbers: phone
        }, {
            headers: { authorization: '' }
        });
        res.json({ success: true, result: response.data });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(3000, () => console.log('API listening on port 3000'));
