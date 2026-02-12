// Minimal prisma config object (avoid importing 'prisma/config' which is Prisma v7-only)
// This preserves the configuration values while staying compatible with Prisma v4.
import "dotenv/config";

const config = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
};

export default config as any;
