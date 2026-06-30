import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Cap the DB connection pool so the full module set (+ worker process) stays
    // well within Postgres max_connections on small/self-hosted instances.
    databaseDriverOptions: {
      pool: { min: 0, max: 5 },
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          {
            resolve: "@medusa-cz/fulfillment-packeta/providers/packeta",
            id: "packeta",
            options: {
              apiKey: process.env.PACKETA_API_KEY,
              apiPassword: process.env.PACKETA_API_PASSWORD,
              eshop: process.env.PACKETA_ESHOP,
              defaultCurrency: "CZK",
              validatePointServerSide: process.env.PACKETA_VALIDATE_POINT !== "false",
              priceTable: {
                cz: { bands: [{ maxWeight: 5, price: 79 }, { maxWeight: 10, price: 99 }], codSurcharge: 30, freeOver: 1500 },
              },
            },
          },
        ],
      },
    },
  ],
})
