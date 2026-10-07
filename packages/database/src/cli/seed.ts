import { seedDevelopmentDatabase } from '../migrations.js';
import { requireDatabaseUrl } from '../client.js';

await seedDevelopmentDatabase(requireDatabaseUrl());
console.log('DentalAI fictional development data seeded successfully.');
