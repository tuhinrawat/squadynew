# Tidio Chat Integration Setup

This project uses [Tidio](https://www.tidio.com) for the chat interface, which provides a mobile-optimized chat experience.

## Setup Instructions

1. **Sign up for Tidio**
   - Go to https://www.tidio.com
   - Create a free account (free tier available)
   - Complete the setup process

2. **Get your Tidio Widget ID**
   - After signing up, go to your Tidio dashboard
   - Navigate to Settings → Channels → Live Chat
   - Find your Widget ID (it's a string like `abc123xyz`)

3. **Add to Environment Variables**
   - Open `.env.local` in the project root
   - Add the following line:
     ```
     NEXT_PUBLIC_TIDIO_ID=your_tidio_widget_id_here
     ```
   - Replace `your_tidio_widget_id_here` with your actual Tidio Widget ID

4. **Restart the Development Server**
   - Stop your current dev server (Ctrl+C)
   - Run `npm run dev` again
   - The Tidio chat widget should now appear on your site

## Features

- ✅ Fully responsive on mobile and desktop
- ✅ Handles keyboard properly without zooming
- ✅ Smooth chat experience
- ✅ Customizable appearance
- ✅ AI chatbot support (paid plans)
- ✅ Live chat support (free tier available)

## Customization

You can customize the Tidio widget appearance and behavior from your Tidio dashboard:
- Widget position and style
- Colors and branding
- Automated messages
- Chatbot workflows
- Operating hours

## Troubleshooting

If the chat widget doesn't appear:
1. Check that `NEXT_PUBLIC_TIDIO_ID` is set correctly in `.env.local`
2. Make sure you've restarted the dev server after adding the env variable
3. Check the browser console for any errors
4. Verify your Tidio account is active

## Notes

- The Tidio widget provides its own floating chat button, so the custom chat icon in the header has been removed
- The widget automatically handles mobile keyboard interactions
- No additional code changes needed - just set the environment variable

