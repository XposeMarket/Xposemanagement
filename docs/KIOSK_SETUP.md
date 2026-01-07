# iPad Kiosk Mode Setup Guide

## Overview
The tracking kiosk allows customers in your waiting room to enter their tracking code on an iPad to view their vehicle's status in real-time.

## Features
- ✅ Clean, touch-friendly interface optimized for iPads
- ✅ Simple 8-character codes (ABC-1234 format) easy to type
- ✅ No login required - customers just enter their code
- ✅ Auto-formatting as they type
- ✅ Real-time status updates
- ✅ Works offline once loaded (caches in browser)

## Quick Setup

### 1. Run Database Migration
First, add short code support to your database:

```bash
# Apply the migration (in Supabase SQL editor or via CLI)
psql -h <your-host> -U postgres -d postgres -f migrations/005_add_short_tracking_codes.sql
```

Or run directly in Supabase SQL Editor:
- Go to Supabase Dashboard → SQL Editor
- Copy contents of `migrations/005_add_short_tracking_codes.sql`
- Run the query

### 2. iPad Setup

#### Hardware Needed:
- iPad (any model from 2018+)
- iPad stand or wall mount
- Power cable (keep plugged in)
- (Optional) Protective case

#### Software Setup:

1. **Open Safari** on the iPad

2. **Navigate to the kiosk URL:**
   ```
   https://your-domain.com/public-tracking-kiosk.html
   ```

3. **Add to Home Screen** (makes it feel like an app):
   - Tap the Share button (square with arrow)
   - Scroll down and tap "Add to Home Screen"
   - Name it "Track My Vehicle"
   - Tap "Add"

4. **Enable Guided Access** (prevents customers from leaving the app):
   - Go to Settings → Accessibility → Guided Access
   - Turn on Guided Access
   - Set a passcode (you'll need this to exit)
   - Turn on "Accessibility Shortcut"

5. **Start Guided Access:**
   - Open the tracking app from home screen
   - Triple-click the side button (or home button)
   - Tap "Start" in top right

6. **Configure Auto-Lock:**
   - Settings → Display & Brightness → Auto-Lock
   - Set to "Never" (while plugged in)

### 3. How Customers Use It

1. Customer receives SMS with their tracking code: **ABC-1234**
2. Customer taps the iPad at your front desk
3. Types in their code: **ABC-1234**
4. Sees their vehicle's real-time status

### 4. Multiple iPad Setup

For larger waiting rooms with multiple iPads:

1. Set up each iPad following steps above
2. Each iPad shows the same kiosk page
3. Customers can use any available iPad
4. Consider labeling: "Track Your Vehicle Here 👆"

## Sending Tracking Codes

### Method 1: Automatic (When Creating Appointment)
Tracking codes are automatically generated and sent when you:
- Create a new appointment
- Click "Send Tracker" from appointment edit modal

### Method 2: Manual Lookup
If customer lost their code:
1. Look up their appointment
2. Click "Send Tracker" again
3. New code generated and sent via SMS/Email

### Method 3: Staff Can Read Code to Customer
In appointments page:
- Open appointment
- The short code is displayed: **ABC-1234**
- Staff can verbally give this to customer

## Code Format

**Format:** 3 Letters + Hyphen + 4 Numbers
**Example:** ABC-1234, XYZ-5678, DEF-9012

**Why this format?**
- Easy to type on iPad
- Easy to read over phone
- No confusing characters (no I, O, Q)
- 456,976 possible combinations (24³ × 10⁴)

## Troubleshooting

### iPad keeps sleeping
- Settings → Display & Brightness → Auto-Lock → Never
- Keep iPad plugged into power

### Customers can exit the app
- Enable Guided Access (see step 2.4 above)
- Triple-click side button to start/stop

### Code not found
- Check if code was sent (look in appointment)
- Verify migration was run successfully
- Try regenerating code ("Send Tracker" again)

### Screen looks zoomed/wrong
- Safari → AA icon → Show Desktop Website (turn OFF)
- Use native iPad resolution

## Best Practices

### Positioning
- ✅ Place near waiting area seating
- ✅ At standing/counter height (not too low)
- ✅ Well-lit area (avoid glare on screen)
- ✅ Near power outlet

### Security
- ✅ Use iPad mount/stand to prevent theft
- ✅ Enable Guided Access
- ✅ Set screen brightness to 70-80%
- ✅ Regular cleaning (use screen-safe wipes)

### Customer Experience
- ✅ Add small sign: "Track Your Vehicle - Enter Code"
- ✅ Include example code on sign: "Example: ABC-1234"
- ✅ Keep staff aware to help customers if needed

## Advanced: Kiosk Display Settings

For true kiosk mode with no distractions:

1. **Hide status bar:**
   - Already enabled via meta tag in HTML

2. **Prevent zoom:**
   - Already disabled via viewport meta tag

3. **Full screen mode:**
   - Automatic when added to home screen

## URL Options

### Standard Kiosk:
```
https://your-domain.com/public-tracking-kiosk.html
```

### With Pre-filled Shop Logo:
Edit the kiosk HTML and add your shop logo URL to show branding.

## Support

### Common Customer Questions

**Q: Where do I get my code?**
A: Check your SMS or email, or ask our staff.

**Q: Code not working?**
A: Ask staff to resend the code.

**Q: What if I don't have a phone?**
A: Staff can look up your vehicle and tell you the code.

## Next Steps

After setup:
1. Test with a real appointment
2. Train staff on how to help customers
3. Monitor usage in first week
4. Gather customer feedback
5. Adjust positioning/signage as needed

---

**Need Help?**
Contact Xpose Management Support
