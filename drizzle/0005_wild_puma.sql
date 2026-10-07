ALTER TABLE `payments` ADD `stripeCheckoutSessionId` varchar(120);--> statement-breakpoint
ALTER TABLE `payments` ADD `stripePaymentIntentId` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(120);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_stripeCheckoutSessionId_unique` UNIQUE(`stripeCheckoutSessionId`);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_stripePaymentIntentId_unique` UNIQUE(`stripePaymentIntentId`);