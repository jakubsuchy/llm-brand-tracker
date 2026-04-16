import swaggerAutogen from 'swagger-autogen';
import path from 'path';

const dir = import.meta.dirname;

const doc = {
  info: {
    title: 'TraceAIO API',
    description: 'Brand tracking across LLM providers',
    version: '1.0.0',
  },
  host: 'localhost:3000',
  basePath: '/',
  schemes: ['http'],
  securityDefinitions: {
    cookieAuth: {
      type: 'apiKey',
      in: 'cookie',
      name: 'connect.sid',
      description: 'Session cookie (browser login)',
    },
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      description: 'API key from user profile (same keys as MCP)',
    },
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication & session management' },
    { name: 'Users', description: 'User management (admin)' },
    { name: 'Metrics', description: 'Dashboard metrics & trends' },
    { name: 'Topics', description: 'Topics & prompts' },
    { name: 'Competitors', description: 'Competitor analysis & merge' },
    { name: 'Sources', description: 'Source analysis & classification' },
    { name: 'Responses', description: 'Prompt responses & data' },
    { name: 'Analysis', description: 'Analysis execution & progress' },
    { name: 'Settings', description: 'Application settings' },
  ],
};

const outputFile = path.join(dir, 'swagger-output.json');
const routes = [
  path.join(dir, 'routes/auth.ts'),
  path.join(dir, 'routes/users.ts'),
  path.join(dir, 'routes/metrics.ts'),
  path.join(dir, 'routes/topics.ts'),
  path.join(dir, 'routes/competitors.ts'),
  path.join(dir, 'routes/sources.ts'),
  path.join(dir, 'routes/responses.ts'),
  path.join(dir, 'routes/analysis.ts'),
  path.join(dir, 'routes/settings.ts'),
];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc).then(() => {
  console.log('Swagger spec generated at', outputFile);
});
