const { randomBytes } = require("crypto");

function parseArgs(argv) {
  const args = { keyId: "v1" };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--id" || token === "-i") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --id");
      }
      args.keyId = value;
      i += 1;
    }
  }

  return args;
}

function main() {
  const { keyId } = parseArgs(process.argv.slice(2));
  const encoded = randomBytes(32).toString("base64");

  console.log("# Copy these into your .env");
  console.log(`MESSAGE_ENCRYPTION_KEY=base64:${encoded}`);
  console.log(`MESSAGE_ENCRYPTION_KEY_ID=${keyId}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
