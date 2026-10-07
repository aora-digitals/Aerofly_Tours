CREATE TABLE `application_checklist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` int NOT NULL,
	`itemKey` varchar(100) NOT NULL,
	`label` varchar(255) NOT NULL,
	`required` boolean NOT NULL DEFAULT true,
	`status` enum('pending','received','approved','rejected','not_applicable') NOT NULL DEFAULT 'pending',
	`notes` text,
	CONSTRAINT `application_checklist_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `application_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` int NOT NULL,
	`userId` int,
	`checklistItemId` int,
	`documentType` varchar(120) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`fileUrl` varchar(700) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`status` enum('uploaded','under_review','approved','rejected') NOT NULL DEFAULT 'uploaded',
	`reviewerNotes` text,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	CONSTRAINT `application_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`applicationId` int NOT NULL,
	`actorId` int,
	`fromStatus` varchar(40),
	`toStatus` varchar(40) NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `application_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `travel_applications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`userId` int,
	`assignedTo` int,
	`type` enum('visa','passport') NOT NULL,
	`serviceType` varchar(120) NOT NULL,
	`applicantName` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`nationality` varchar(120) NOT NULL,
	`destinationCountry` varchar(120),
	`travelDate` varchar(40),
	`urgency` enum('standard','urgent') NOT NULL DEFAULT 'standard',
	`status` enum('draft','submitted','under_review','action_required','approved','rejected','completed','cancelled') NOT NULL DEFAULT 'submitted',
	`customerNotes` text,
	`internalNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `travel_applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `travel_applications_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `application_checklist_items` ADD CONSTRAINT `application_checklist_items_applicationId_travel_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `travel_applications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_documents` ADD CONSTRAINT `application_documents_applicationId_travel_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `travel_applications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_documents` ADD CONSTRAINT `application_documents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_documents` ADD CONSTRAINT `application_documents_checklistItemId_application_checklist_items_id_fk` FOREIGN KEY (`checklistItemId`) REFERENCES `application_checklist_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_events` ADD CONSTRAINT `application_events_applicationId_travel_applications_id_fk` FOREIGN KEY (`applicationId`) REFERENCES `travel_applications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_events` ADD CONSTRAINT `application_events_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `travel_applications` ADD CONSTRAINT `travel_applications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `travel_applications` ADD CONSTRAINT `travel_applications_assignedTo_users_id_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `application_checklist_application_idx` ON `application_checklist_items` (`applicationId`);--> statement-breakpoint
CREATE INDEX `application_documents_application_idx` ON `application_documents` (`applicationId`);--> statement-breakpoint
CREATE INDEX `application_documents_status_idx` ON `application_documents` (`status`);--> statement-breakpoint
CREATE INDEX `application_events_application_idx` ON `application_events` (`applicationId`);--> statement-breakpoint
CREATE INDEX `travel_applications_user_idx` ON `travel_applications` (`userId`);--> statement-breakpoint
CREATE INDEX `travel_applications_status_idx` ON `travel_applications` (`status`);--> statement-breakpoint
CREATE INDEX `travel_applications_type_idx` ON `travel_applications` (`type`);