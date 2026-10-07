CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`userId` int,
	`enquiryId` int,
	`assignedTo` int,
	`name` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`appointmentAt` timestamp NOT NULL,
	`durationMinutes` int NOT NULL DEFAULT 30,
	`mode` enum('phone','video','office') NOT NULL DEFAULT 'phone',
	`purpose` varchar(255) NOT NULL,
	`status` enum('requested','confirmed','completed','cancelled','no_show') NOT NULL DEFAULT 'requested',
	`meetingLink` varchar(500),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appointments_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `callback_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`userId` int,
	`enquiryId` int,
	`assignedTo` int,
	`name` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`preferredAt` timestamp,
	`reason` varchar(255) NOT NULL,
	`status` enum('requested','scheduled','completed','cancelled') NOT NULL DEFAULT 'requested',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callback_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `callback_requests_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_enquiryId_enquiries_id_fk` FOREIGN KEY (`enquiryId`) REFERENCES `enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_assignedTo_users_id_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callback_requests` ADD CONSTRAINT `callback_requests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callback_requests` ADD CONSTRAINT `callback_requests_enquiryId_enquiries_id_fk` FOREIGN KEY (`enquiryId`) REFERENCES `enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callback_requests` ADD CONSTRAINT `callback_requests_assignedTo_users_id_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `appointments_status_idx` ON `appointments` (`status`);--> statement-breakpoint
CREATE INDEX `appointments_at_idx` ON `appointments` (`appointmentAt`);--> statement-breakpoint
CREATE INDEX `callback_requests_status_idx` ON `callback_requests` (`status`);--> statement-breakpoint
CREATE INDEX `callback_requests_created_idx` ON `callback_requests` (`createdAt`);