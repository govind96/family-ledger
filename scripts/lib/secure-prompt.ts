import { createInterface } from "node:readline/promises";

export async function promptText(
  label: string,
  options: { required?: boolean; validate?: (value: string) => string | null } = {},
): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const value = (await readline.question(`${label}: `)).trim();
      if (options.required && !value) {
        process.stdout.write("A value is required.\n");
        continue;
      }
      const error = options.validate?.(value);
      if (error) {
        process.stdout.write(`${error}\n`);
        continue;
      }
      return value;
    }
  } finally {
    readline.close();
  }
}

export async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("SECURE_TTY_REQUIRED");
  }

  process.stdout.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("PROMPT_CANCELLED"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (/^[\x20-\x7E]$/.test(character)) {
          value += character;
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await promptText(`${question} [y/N]`, { required: false });
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
