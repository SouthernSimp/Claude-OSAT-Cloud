const { app } = require('electron');
const path = require('node:path');
if (!process.env.OSAT_QA_DATA || !process.env.OSAT_QA_ENTRY) throw new Error('QA requires an isolated data directory and app entry.');
app.setPath('appData', process.env.OSAT_QA_DATA);
app.setPath('userData', path.join(process.env.OSAT_QA_DATA, 'OSAT V2'));
require(process.env.OSAT_QA_ENTRY);
