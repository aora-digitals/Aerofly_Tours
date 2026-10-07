CREATE TABLE `blog_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(180) NOT NULL,
	`title` varchar(220) NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`category` varchar(100) NOT NULL,
	`imageUrl` text NOT NULL,
	`author` varchar(120) DEFAULT 'AeroFly Editorial',
	`status` enum('draft','published') NOT NULL DEFAULT 'published',
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `blog_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_posts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`userId` int,
	`tourId` int,
	`destination` varchar(160) NOT NULL,
	`travelDates` varchar(120) NOT NULL,
	`travellers` int NOT NULL,
	`amount` decimal(12,2),
	`bookingStatus` enum('pending','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
	`paymentStatus` enum('pending','initiated','successful','failed','refunded') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `destinations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(160) NOT NULL,
	`name` varchar(160) NOT NULL,
	`country` varchar(120) NOT NULL,
	`region` varchar(120),
	`kind` enum('domestic','international') NOT NULL,
	`tagline` varchar(255),
	`description` text,
	`imageUrl` text,
	`featured` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `destinations_id` PRIMARY KEY(`id`),
	CONSTRAINT `destinations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(32) NOT NULL,
	`userId` int,
	`tourId` int,
	`name` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`destination` varchar(160),
	`travelDates` varchar(120),
	`travellers` int NOT NULL DEFAULT 2,
	`budget` varchar(80),
	`tripType` varchar(80),
	`message` text,
	`status` enum('new','contacted','quotation','confirmed','completed','cancelled') NOT NULL DEFAULT 'new',
	`priority` enum('low','normal','high') NOT NULL DEFAULT 'normal',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `enquiries_id` PRIMARY KEY(`id`),
	CONSTRAINT `enquiries_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(120) NOT NULL,
	`settingValue` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_settingKey_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`destination` varchar(120) NOT NULL,
	`quote` text NOT NULL,
	`rating` int NOT NULL DEFAULT 5,
	`verified` boolean NOT NULL DEFAULT false,
	`published` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `testimonials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tour_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`imageUrl` text,
	`accent` varchar(30) DEFAULT 'orange',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tour_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `tour_categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `tour_itineraries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tourId` int NOT NULL,
	`dayNumber` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`meals` varchar(160),
	`stay` varchar(160),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tour_itineraries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tours` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(180) NOT NULL,
	`title` varchar(220) NOT NULL,
	`destinationId` int NOT NULL,
	`categoryId` int NOT NULL,
	`durationDays` int NOT NULL,
	`durationNights` int NOT NULL,
	`priceFrom` decimal(12,2) NOT NULL,
	`originalPrice` decimal(12,2),
	`rating` decimal(3,1) NOT NULL DEFAULT '4.8',
	`reviewCount` int NOT NULL DEFAULT 0,
	`overview` text NOT NULL,
	`highlights` text,
	`inclusions` text,
	`exclusions` text,
	`imageUrl` text NOT NULL,
	`galleryUrls` text,
	`tags` varchar(500),
	`availability` varchar(100) NOT NULL DEFAULT 'On request',
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'published',
	`featured` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tours_id` PRIMARY KEY(`id`),
	CONSTRAINT `tours_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_tourId_tours_id_fk` FOREIGN KEY (`tourId`) REFERENCES `tours`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enquiries` ADD CONSTRAINT `enquiries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enquiries` ADD CONSTRAINT `enquiries_tourId_tours_id_fk` FOREIGN KEY (`tourId`) REFERENCES `tours`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tour_itineraries` ADD CONSTRAINT `tour_itineraries_tourId_tours_id_fk` FOREIGN KEY (`tourId`) REFERENCES `tours`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tours` ADD CONSTRAINT `tours_destinationId_destinations_id_fk` FOREIGN KEY (`destinationId`) REFERENCES `destinations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tours` ADD CONSTRAINT `tours_categoryId_tour_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `tour_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `destinations_kind_idx` ON `destinations` (`kind`);--> statement-breakpoint
CREATE INDEX `destinations_featured_idx` ON `destinations` (`featured`);--> statement-breakpoint
CREATE INDEX `enquiries_status_idx` ON `enquiries` (`status`);--> statement-breakpoint
CREATE INDEX `enquiries_created_idx` ON `enquiries` (`createdAt`);--> statement-breakpoint
CREATE INDEX `itinerary_tour_idx` ON `tour_itineraries` (`tourId`);--> statement-breakpoint
CREATE INDEX `tours_destination_idx` ON `tours` (`destinationId`);--> statement-breakpoint
CREATE INDEX `tours_category_idx` ON `tours` (`categoryId`);--> statement-breakpoint
CREATE INDEX `tours_status_idx` ON `tours` (`status`);--> statement-breakpoint
CREATE INDEX `tours_featured_idx` ON `tours` (`featured`);