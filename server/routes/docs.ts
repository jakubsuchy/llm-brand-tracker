import type { Express } from "express";

export async function registerDocsRoutes(app: Express) {
  try {
    const swaggerUi = await import('swagger-ui-express');
    const { default: swaggerSpec } = await import('../swagger-output.json', { with: { type: 'json' } });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  } catch (error) {
    console.warn('[STARTUP] Swagger UI not available — run `npm run swagger` to generate spec');
  }
}
