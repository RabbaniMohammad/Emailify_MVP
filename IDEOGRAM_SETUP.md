# Ideogram 2.0 Image Generation Setup

## Environment Configuration

Add the following environment variable to your backend `.env` file:

```bash
IDEOGRAM_API_KEY=your_ideogram_api_key_here
```

## Getting an Ideogram API Key

1. Visit [Ideogram.ai](https://ideogram.ai/)
2. Sign up for an account
3. Navigate to your API settings/dashboard
4. Generate a new API key
5. Copy the API key to your `.env` file

## Testing the Integration

1. Start the backend server
2. Navigate to the Generate Template page
3. Select "AI Image" radio button
4. Enter a prompt (e.g., "A futuristic email marketing illustration with purple and pink gradients")
5. Click Send
6. View generated images in the left panel

## Features Implemented

### Frontend
- ✅ Beautiful radio button selector (Template/Image)
- ✅ Image gallery display with grid layout
- ✅ Loading states for image generation
- ✅ Empty state UI when no images generated
- ✅ Image preview with download and copy actions
- ✅ Responsive design for mobile/tablet

### Backend
- ✅ Ideogram API integration routes:
  - `/api/ideogram/generate` - Generate images
  - `/api/ideogram/describe` - Describe images
  - `/api/ideogram/remix` - Remix existing images
- ✅ Error handling and validation
- ✅ Authentication middleware integration

### Service Layer
- ✅ `IdeogramImageService` with methods for:
  - Generate single/multiple images
  - Describe images
  - Remix images
  - Support for various aspect ratios and styles

## Ideogram 2.0 Features Supported

- **Models**: V_2, V_2_TURBO
- **Aspect Ratios**: 1:1, 16:9, 9:16, 4:3, 3:4
- **Style Types**: GENERAL, REALISTIC, DESIGN, RENDER_3D, ANIME
- **Magic Prompt**: AUTO, ON, OFF (enhances prompts automatically)
- **Negative Prompts**: Specify what you don't want in the image

## Usage Notes

- Users can switch between Template and Image generation using radio buttons
- Only one mode can be active at a time (enforced in UI)
- Generated images are displayed in a beautiful grid layout
- Each image shows the prompt used to generate it
- Images can be downloaded or copied via action buttons
