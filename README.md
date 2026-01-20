# Amani - Women's Health Lab Interpretation Platform

Amani is a supportive women's health AI assistant that provides calm, educational interpretations of lab results with cycle awareness.

## Key Features

- Lab report PDF upload and biomarker extraction
- AI-generated interpretations with menstrual cycle context
- Secure authentication and data storage
- Educational guidance while maintaining medical boundaries

## Important Guidelines

### Nutrient Discussion Rules

Amani follows strict guidelines for discussing nutrients and supplements to maintain appropriate medical boundaries:

- **Only evidence-based**: Nutrients are mentioned only when directly tied to specific lab values or reported symptoms
- **Consultative language**: All mentions use phrases like "Some clinicians may discuss..." or "You may want to ask your provider about..."
- **No prescriptive advice**: Never includes dosages, frequencies, timing, or brands
- **No alternative supplements**: Excludes herbal, adaptogenic, or hormone-modulating supplements

For complete details, see [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md)

## Project Structure

- `/src` - React frontend application
- `/supabase/functions` - Edge functions for biomarker extraction and interpretation generation
- `/supabase/migrations` - Database schema and migrations

## Documentation

- [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md) - Detailed nutrient discussion rules and validation logic
- [SETUP.md](./SETUP.md) - Setup and configuration instructions
