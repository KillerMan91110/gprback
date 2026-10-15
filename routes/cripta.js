// La Cripta del Vigía (ver lib/cripta.js): estado del recorrido, braseros y combates contra los
// guardianes y el jefe. Montado en /api/player/:playerId/world/cripta. Las rutas son las del molde
// de mazmorras (routes/mazmorra.js).
module.exports = require('./mazmorra')(require('../lib/cripta'));
