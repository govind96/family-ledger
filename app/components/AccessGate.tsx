import { LockKeyhole, ShieldAlert, Wrench } from "lucide-react";

type AccessGateProps =
  | { kind: "signed-out"; signInPath: string; viewerEmail?: never }
  | { kind: "local-unavailable"; signInPath?: never; viewerEmail?: never }
  | { kind: "hosted-auth-failed"; signInPath?: never; viewerEmail?: never }
  | {
      kind: "unauthorized" | "unavailable";
      viewerEmail: string;
      signInPath?: never;
    };

export function AccessGate(props: AccessGateProps) {
  const copy = {
    "signed-out": {
      icon: LockKeyhole,
      eyebrow: "Private family workspace",
      title: "Your holdings stay behind a locked door.",
      body: "Sign in to open the view-only family portfolio. Account sign-in secrets are never available in this dashboard.",
    },
    unauthorized: {
      icon: ShieldAlert,
      eyebrow: "Access not granted",
      title: "This identity is not on the family allowlist.",
      body: "The dashboard denies access unless the signed-in email is explicitly configured by the administrator.",
    },
    unavailable: {
      icon: Wrench,
      eyebrow: "Temporarily unavailable",
      title: "The private ledger could not be opened.",
      body: "No portfolio data was exposed. Check the local data service and try again.",
    },
    "local-unavailable": {
      icon: Wrench,
      eyebrow: "Local data unavailable",
      title: "The secure local ledger could not be opened.",
      body: "No portfolio data was exposed. Check the local database and restart the secure dashboard.",
    },
    "hosted-auth-failed": {
      icon: ShieldAlert,
      eyebrow: "Access verification failed",
      title: "The private ledger stayed locked.",
      body: "Cloudflare Access did not provide a valid signed identity. No portfolio data was exposed.",
    },
  }[props.kind];
  const Icon = copy.icon;

  return (
    <main className="grain grid min-h-dvh place-items-center px-5 py-12">
      <section
        className="w-full max-w-lg rounded-3xl border border-line bg-surface p-8 text-center shadow-md sm:p-12"
        aria-labelledby="access-title"
      >
        <div
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"
          aria-hidden="true"
        >
          <Icon size={24} strokeWidth={1.9} />
        </div>

        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
          {copy.eyebrow}
        </p>
        <h1
          id="access-title"
          className="mt-2.5 text-[clamp(26px,5vw,36px)] font-extrabold leading-[1.1] tracking-[-0.035em] text-ink"
        >
          {copy.title}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[13.5px] leading-relaxed text-ink-muted">
          {copy.body}
        </p>

        {props.kind === "signed-out" ? (
          <a
            className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-7 text-[13.5px] font-semibold text-accent-on transition-colors hover:bg-accent-hover"
            href={props.signInPath}
          >
            Sign in securely
          </a>
        ) : null}

        {props.kind === "unauthorized" || props.kind === "unavailable" ? (
          <p className="mt-6 text-[12px] text-ink-faint">
            Signed in as{" "}
            <span className="font-semibold text-ink-soft">
              {props.viewerEmail}
            </span>
          </p>
        ) : null}

        <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-line pt-6 text-[11.5px] text-ink-muted">
          {[
            "View-only CDSL access",
            "No trading controls",
            "Secrets isolated",
          ].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full bg-accent"
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
