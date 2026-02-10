# SUPACLEAN POS System

Point of Sale software for SUPACLEAN Laundry & Dry Cleaning business in Arusha, Tanzania.

## Features

- **Customer Management**: Store and manage customer information (name, phone number)
- **Order Management**: Create orders with garment details (type, color, quantity)
- **Service Types**: 
  - Wash, Dry & Fold
  - Pressing
  - Express Service (same-day delivery)
  - Standard Washing
- **Receipt Generation**: Print receipts for customers at drop-off
- **Collection System**: Verify receipts when customers collect their laundry
- **SMS Notifications**: Send automated SMS when laundry is ready for collection
- **Cash Management**: Track daily cash transactions and generate reports
- **Daily Reports**: View sales summaries, customer history, and service analytics

## Technology Stack

- **Frontend**: React.js with modern UI components
- **Backend**: Node.js with Express
- **Database**: SQLite (easy to set up, can migrate to PostgreSQL later)
- **SMS Integration**: Ready for integration with Tanzanian SMS providers

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn package manager

### Installation Steps

1. **Install all dependencies:**
```bash
npm run install-all
```

2. **Set up environment variables:**
   Create a `.env` file in the root directory:
```env
PORT=5000
NODE_ENV=development

# SMS Service Configuration (Optional - for notifications)
SMS_API_KEY=your_sms_api_key_here
SMS_API_URL=https://api.africastalking.com/version1/messaging
SMS_USERNAME=your_sms_username_here
```

   **Note:** SMS notifications will work without API keys (for testing), but won't actually send messages until configured.

3. **Start the development servers:**
```bash
npm run dev
```

   This will start:
   - Backend server on `http://localhost:5000`
   - Frontend React app on `http://localhost:3000`

4. **Access the application:**
   Open your browser and navigate to `http://localhost:3000`

### First Time Setup

When you first run the application, the database will be automatically created with default services:
- Wash, Dry & Fold
- Pressing
- Express Service
- Standard Wash

You can modify these services and their pricing from the backend or through the API.

### SMS Integration

To enable SMS notifications when laundry is ready:

1. Sign up with an SMS provider in Tanzania (recommended: Africa's Talking)
2. Get your API credentials
3. Add them to the `.env` file
4. The system will automatically send SMS notifications when orders are marked as "ready"

### Production Deployment

For production:
1. Build the React frontend: `npm run build`
2. Set `NODE_ENV=production` in `.env`
3. Use a process manager like PM2 to run the server
4. Consider migrating to PostgreSQL for better performance

## Project Structure

```
├── client/          # React frontend application
├── server/          # Node.js/Express backend
│   ├── routes/      # API routes
│   ├── models/      # Database models
│   └── utils/       # Helper functions (SMS, receipts, etc.)
└── database/        # SQLite database file
```

## Features in Development

- Multi-language support (English/Swahili)
- Advanced reporting and analytics
- Inventory management
- Staff management
- Online payment integration

## Support

For questions or issues, please contact SUPACLEAN support.
