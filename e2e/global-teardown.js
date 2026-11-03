const { dropDatabase } = require('./seed');

module.exports = async () => {
    if (process.env.E2E_KEEP_DB === '1') return;   // keep it to look at the data after a failing run
    await dropDatabase();
};
