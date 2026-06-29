import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  plugins: [
    {
      resolve: "@medusa-cz/payment-comgate",
      options: {},
    },
  ],
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusa-cz/payment-comgate/providers/comgate",
            id: "comgate",
            options: {
              merchant: process.env.COMGATE_MERCHANT,
              secret: process.env.COMGATE_SECRET,
              test: process.env.COMGATE_TEST !== "false",
              capture: process.env.COMGATE_CAPTURE ?? "automatic",
            },
          },
        ],
      },
    },
  ],
})
