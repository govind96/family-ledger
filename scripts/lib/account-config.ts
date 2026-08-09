import { mkdir, readFile, rename, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const accountSchema = z
  .object({
    id: z.string().uuid(),
    ownerLabel: z.string().min(1).max(80),
    accountLabel: z.string().min(1).max(80),
    brokerLabel: z.string().min(1).max(80),
    // The BO ID is purely a dashboard label, so it may be omitted. Credentials
    // remain the only data required to connect to CDSL.
    boidLast4: z.string().regex(/^(?:\d{4})?$/),
    consentedAt: z.string().datetime(),
    enabled: z.boolean(),
  })
  .strict();

const configSchema = z
  .object({ version: z.literal(1), accounts: z.array(accountSchema).max(100) })
  .strict();

export type LocalAccount = z.infer<typeof accountSchema>;
export type AccountConfig = z.infer<typeof configSchema>;

const configDirectory = path.resolve(process.cwd(), "config");
export const configPath = path.join(configDirectory, "accounts.local.json");

export async function readAccountConfig(): Promise<AccountConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    return configSchema.parse(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { version: 1, accounts: [] };
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new Error("INVALID_ACCOUNT_CONFIG");
    }
    throw error;
  }
}

export async function writeAccountConfig(config: AccountConfig): Promise<void> {
  const validated = configSchema.parse(config);
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, configPath);
  await chmod(configPath, 0o600);
}
