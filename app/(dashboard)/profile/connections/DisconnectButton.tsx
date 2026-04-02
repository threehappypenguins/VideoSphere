'use client';

interface DisconnectButtonProps {
  action: () => Promise<void>;
  platformLabel: string;
}

export function DisconnectButton({ action, platformLabel }: DisconnectButtonProps) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Are you sure you want to disconnect your ${platformLabel} account?`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
      >
        Disconnect
      </button>
    </form>
  );
}
