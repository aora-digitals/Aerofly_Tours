import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import {
  blogPosts,
  destinations,
  settings,
  testimonials,
  tourCategories,
  tourItineraries,
  tours,
} from "../drizzle/schema";

const db = drizzle(process.env.DATABASE_URL!);
const image = {
  dubai: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=85",
  goa: "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=85",
  kerala: "https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1200&q=85",
  rajasthan: "https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=1200&q=85",
  bali: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85",
  himalaya: "https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=85",
  city: "https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=1200&q=85",
};

async function seed() {
  const categories = [
    ["family", "Family Tours", "Easy-paced journeys designed around together time.", image.kerala],
    ["honeymoon", "Honeymoon Escapes", "Thoughtful stays and private moments for two.", image.bali],
    ["group", "Group Tours", "Well-coordinated departures with a warm, social rhythm.", image.rajasthan],
    ["adventure", "Adventure Tours", "The kind of landscapes that make the route worthwhile.", image.himalaya],
    ["weekend", "Weekend Getaways", "Short breaks with a considered itinerary.", image.goa],
    ["international", "International Tours", "Confident planning beyond the familiar.", image.city],
  ] as const;
  for (const [slug, name, description, imageUrl] of categories) {
    await db.insert(tourCategories).values({ slug, name, description, imageUrl }).onDuplicateKeyUpdate({ set: { name, description, imageUrl } });
  }

  const destinationsData = [
    ["goa", "Goa", "India", "West Coast", "domestic", "Sun, spice and slow coastal mornings.", image.goa, true],
    ["kerala", "Kerala", "India", "South India", "domestic", "Backwaters, tea country and unhurried hospitality.", image.kerala, true],
    ["rajasthan", "Rajasthan", "India", "North India", "domestic", "Forts, desert light and living craft traditions.", image.rajasthan, true],
    ["himachal", "Himachal Pradesh", "India", "North India", "domestic", "Mountain air, pine trails and small-town warmth.", image.himalaya, false],
    ["dubai", "Dubai", "United Arab Emirates", "Gulf", "international", "A confident city break with sky-high possibilities.", image.dubai, true],
    ["bali", "Bali", "Indonesia", "Southeast Asia", "international", "A softer island pace, from rice terraces to reef time.", image.bali, true],
    ["singapore", "Singapore", "Singapore", "Southeast Asia", "international", "Food, design and a city made for easy exploration.", image.city, false],
  ] as const;
  for (const [slug, name, country, region, kind, tagline, imageUrl, featured] of destinationsData) {
    await db.insert(destinations).values({ slug, name, country, region, kind, tagline, imageUrl, featured }).onDuplicateKeyUpdate({ set: { name, tagline, imageUrl, featured } });
  }

  const cats = await db.select().from(tourCategories);
  const dests = await db.select().from(destinations);
  const categoryId = (slug: string) => cats.find((c) => c.slug === slug)!.id;
  const destinationId = (slug: string) => dests.find((d) => d.slug === slug)!.id;
  const toursData = [
    { slug: "dubai-city-lights", title: "Dubai City Lights", destinationId: destinationId("dubai"), categoryId: categoryId("international"), durationDays: 5, durationNights: 4, priceFrom: "64900", originalPrice: "74900", rating: "4.9", reviewCount: 28, overview: "A considered Dubai itinerary balancing iconic city moments with space to discover the city at your own pace.", highlights: "Burj Khalifa sunset\nDesert safari with dinner\nMarina evening cruise\nAirport transfers", inclusions: "4 nights stay\nDaily breakfast\nSightseeing transfers\nTravel assistance", exclusions: "Airfare\nPersonal expenses\nOptional activities", imageUrl: image.dubai, tags: "City break,Family,First-time Dubai", availability: "Departures on request", featured: true },
    { slug: "kerala-slow-journey", title: "Kerala, The Slow Journey", destinationId: destinationId("kerala"), categoryId: categoryId("family"), durationDays: 6, durationNights: 5, priceFrom: "38900", originalPrice: "44900", rating: "4.8", reviewCount: 36, overview: "From Kochi's old lanes to a private night on the backwaters, this is Kerala with time built in.", highlights: "Fort Kochi heritage walk\nMunnar tea gardens\nPrivate houseboat stay\nLocal cuisine experience", inclusions: "5 nights accommodation\nBreakfast and dinner\nPrivate vehicle\nHouseboat cruise", exclusions: "Flights\nLunches\nTravel insurance", imageUrl: image.kerala, tags: "Backwaters,Family,Wellness", availability: "Year-round", featured: true },
    { slug: "royal-rajasthan-trail", title: "The Royal Rajasthan Trail", destinationId: destinationId("rajasthan"), categoryId: categoryId("group"), durationDays: 8, durationNights: 7, priceFrom: "52900", originalPrice: "59900", rating: "4.7", reviewCount: 22, overview: "A story-rich circuit across Jaipur, Jodhpur and Udaipur, with hotels that let the architecture do some of the talking.", highlights: "Amber Fort\nBlue City lanes\nLake Pichola boat ride\nCultural evening", inclusions: "7 nights stay\nBreakfast\nPrivate transfers\nLocal guide", exclusions: "Flights\nMonument fees\nPersonal expenses", imageUrl: image.rajasthan, tags: "Culture,Heritage,Group", availability: "Monthly departures", featured: true },
    { slug: "bali-island-reset", title: "Bali Island Reset", destinationId: destinationId("bali"), categoryId: categoryId("honeymoon"), durationDays: 7, durationNights: 6, priceFrom: "71900", originalPrice: "81900", rating: "4.9", reviewCount: 31, overview: "A gentle island rhythm for couples who want a little design, a little nature, and plenty of room to breathe.", highlights: "Ubud rice terraces\nPrivate pool villa\nSunset temple visit\nNusa Penida day trip", inclusions: "6 nights stay\nBreakfast\nPrivate transfers\nSelected excursions", exclusions: "Flights\nVisa fees\nTravel insurance", imageUrl: image.bali, tags: "Honeymoon,Island,Private", availability: "On request", featured: true },
  ];
  for (const tour of toursData) {
    await db.insert(tours).values(tour).onDuplicateKeyUpdate({ set: { title: tour.title, destinationId: tour.destinationId, categoryId: tour.categoryId, priceFrom: tour.priceFrom, originalPrice: tour.originalPrice, rating: tour.rating, reviewCount: tour.reviewCount, overview: tour.overview, highlights: tour.highlights, inclusions: tour.inclusions, exclusions: tour.exclusions, imageUrl: tour.imageUrl, tags: tour.tags, availability: tour.availability, featured: tour.featured } });
  }

  const seededTours = await db.select().from(tours);
  const itineraryBySlug: Record<string, string[]> = {
    "dubai-city-lights": ["Arrive in Dubai and settle into your city stay.", "Old Dubai and creekside stories with your local host.", "A full day between the desert and the dunes.", "Marina, Palm and a golden-hour skyline.", "Breakfast, final shopping and departure."],
    "kerala-slow-journey": ["Arrive in Kochi and meet your trip coordinator.", "Fort Kochi heritage lanes and local flavours.", "Travel into Munnar's tea country.", "Tea gardens, viewpoints and a slow afternoon.", "Transfer to Alleppey for your private houseboat.", "Wake on the backwaters and return home with time to spare."],
    "royal-rajasthan-trail": ["Arrive in Jaipur, the Pink City.", "Amber Fort and a first taste of old Jaipur.", "Travel to Jodhpur through changing desert light.", "Blue City walk and Mehrangarh Fort.", "Continue to Udaipur by road.", "Lake Pichola at sunset.", "A final cultural evening and unhurried breakfast.", "Departure with your route notes."],
    "bali-island-reset": ["Arrive in Bali and transfer to your Ubud stay.", "Rice terraces and a gentle village walk.", "A private day built around your pace.", "Move to the coast and reset by the sea.", "Nusa Penida day trip.", "Sunset, spa time and a last dinner.", "Breakfast and airport transfer."],
  };
  for (const tour of seededTours) {
    const days = itineraryBySlug[tour.slug];
    if (!days) continue;
    for (let i = 0; i < days.length; i++) {
      await db.insert(tourItineraries).values({ tourId: tour.id, dayNumber: i + 1, title: i === 0 ? "Arrival & orientation" : i === days.length - 1 ? "Departure" : `Day ${i + 1} — Explore at your pace`, description: days[i], meals: i === 0 ? "Welcome drink" : "Breakfast", stay: i === days.length - 1 ? "—" : "Handpicked stay" });
    }
  }

  const posts = [
    { slug: "how-to-plan-a-kerala-holiday", title: "How to plan a Kerala holiday that still feels unhurried", excerpt: "A practical way to balance backwaters, hills and beach time without turning the route into a checklist.", content: "Kerala rewards a little breathing room. Start with the landscape you want to wake up to, then let the route follow.", category: "Destination Guides", imageUrl: image.kerala, publishedAt: new Date("2026-08-18") },
    { slug: "first-time-dubai-notes", title: "First-time Dubai: the details worth planning ahead", excerpt: "From airport transfers to choosing your neighbourhood, a few small decisions make the city feel much easier.", content: "Dubai is at its best when the big-ticket moments are balanced with a little local context and room to wander.", category: "Travel Guides", imageUrl: image.dubai, publishedAt: new Date("2026-08-05") },
    { slug: "a-better-weekend-getaway", title: "A better weekend getaway starts before you leave", excerpt: "Three questions to ask before choosing a short break from Pune, Mumbai or Bengaluru.", content: "Short trips need intention. Think about the feeling you want to bring home, not just the number of places you can tick off.", category: "Travel Tips", imageUrl: image.goa, publishedAt: new Date("2026-07-22") },
  ];
  for (const post of posts) await db.insert(blogPosts).values(post).onDuplicateKeyUpdate({ set: { title: post.title, excerpt: post.excerpt, imageUrl: post.imageUrl, content: post.content } });

  const reviews = [
    { name: "Sample traveller · development content", destination: "Kerala", quote: "Sample testimonial content — replace this record from the admin panel before publishing.", rating: 5, verified: false, published: false },
    { name: "Sample traveller · development content", destination: "Dubai", quote: "Sample testimonial content — replace this record from the admin panel before publishing.", rating: 5, verified: false, published: false },
  ];
  for (const review of reviews) await db.insert(testimonials).values(review);

  const config = {
    company_name: "AeroFly Tours",
    city: "Pune, Maharashtra",
    phone: "+91 20 0000 0000 · placeholder",
    email: "hello@aeroflytours.com · placeholder",
    whatsapp: "WhatsApp number to be configured",
    footer_note: "Travel planning, thoughtfully coordinated from Pune.",
  };
  for (const [settingKey, settingValue] of Object.entries(config)) await db.insert(settings).values({ settingKey, settingValue }).onDuplicateKeyUpdate({ set: { settingValue } });

  console.log("AeroFly sample data seeded");
}

seed().catch((error) => { console.error(error); process.exit(1); });
