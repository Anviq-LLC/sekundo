import { PaymentWalletRequestRejected } from "@anviq/adapter-kit";
import type { PaymentWalletDeps } from "@anviq/adapters";
import {
  connectPaymentWallet,
  disconnectPaymentWallet,
  paymentWalletStatus,
} from "@anviq/adapters";
import { recordSecurityEvent } from "@anviq/db";
import { ORPCError } from "@orpc/server";
import { paymentWalletConnectedEvent } from "../auth/security-audit.js";
import type { RouterContext } from "./context.js";

export function paymentWalletRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const wallet: PaymentWalletDeps = {
    prisma: deps.prisma,
    secretStore: deps.secrets,
    jobs: deps.jobs,
    paymentWallet: deps.paymentWallet,
  };
  return {
    paymentWallet: {
      status: authed.paymentWallet.status.handler(({ context }) =>
        paymentWalletStatus(wallet, context.actor, {
          onConnected: () => recordSecurityEvent(paymentWalletConnectedEvent(context.actor)),
        }),
      ),
      connect: authed.paymentWallet.connect.handler(async ({ context }) => {
        if (!deps.paymentWallet) throw new ORPCError("NOT_FOUND");
        try {
          return await connectPaymentWallet(wallet, context.actor);
        } catch (error) {
          if (error instanceof PaymentWalletRequestRejected)
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          throw error;
        }
      }),
      disconnect: authed.paymentWallet.disconnect.handler(({ context }) =>
        disconnectPaymentWallet(wallet, context.actor),
      ),
    },
  };
}
