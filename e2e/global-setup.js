const { createDatabase } = require('./seed');

module.exports = async () => {
    await createDatabase();
};
