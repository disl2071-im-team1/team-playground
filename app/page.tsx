export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-24 text-zinc-900">
      <div className="max-w-2xl space-y-8 text-center">
        <h1 className="text-6xl font-semibold tracking-tight">Team 1</h1>
        <p className="text-xl text-zinc-500">
          Hyper Island Innovation and Strategic Leadership, 2026-2027
        </p>
        <p className="text-lg leading-relaxed text-zinc-700">
          This is where we build small things together to learn big ones. Most
          experiments here will stay small or get quietly abandoned, and that's
          the point. Read each other's code, ask each other questions, leave
          traces.
        </p>
        <div className="pt-4">
          <div className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Prototypes
          </div>
          <ul className="mt-3 space-y-2 text-lg">
            <li>
              <a
                href="/cleanpath/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Clean Path
              </a>
              <span className="text-zinc-500">
                {" "}
                · routing Stockholm by air quality, not just time
              </span>
            </li>
            <li>
              <a
                href="/pelle/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Catch the Button
              </a>
              <span className="text-zinc-500">
                {" "}
                · chase a button that runs away every time you click it
              </span>
            </li>
            <li>
              <a
                href="/mike/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Mike's Click Game
              </a>
              <span className="text-zinc-500">
                {" "}
                · a yellow button, a counter, and the joy of clicking
              </span>
            </li>
            <li>
              <a
                href="/natalie/timer/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Mega Timer 3000
              </a>
              <span className="text-zinc-500">
                {" "}
                · a retro 90s kitchen timer, beeps included
              </span>
            </li>
            <li>
              <a
                href="/jonas/cardgame/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Galdrastafur
              </a>
              <span className="text-zinc-500">
                {" "}
                · a Norse rune puzzle, six wards to break before the deck runs out
              </span>
            </li>
            <li>
              <a
                href="/counter/index.html"
                className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900"
              >
                Counter Game
              </a>
              <span className="text-zinc-500">
                {" "}
                · click the button, watch the number go up
              </span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
