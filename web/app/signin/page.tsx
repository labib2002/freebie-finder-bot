import { startSignIn } from "@/lib/actions";

export default function SignIn() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-2xl font-bold">Sign in to Freebie Finder</h1>
      <p className="mt-2 text-sm text-gray-500">
        Enter your email and we&apos;ll send you a magic link. No password needed.
      </p>
      <form action={startSignIn} className="mt-6 flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
        >
          Send magic link
        </button>
      </form>
    </main>
  );
}
