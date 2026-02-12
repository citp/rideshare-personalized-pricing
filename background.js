// ── 144 trips with hardcoded UTC times (editable) ──
const TRIPS = [
  { utcTime: "00:00", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "00:10", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "00:20", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "00:30", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "00:40", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "00:50", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "01:00", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "01:10", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "01:20", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "01:30", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "01:40", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "01:50", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "02:00", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "02:10", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "02:20", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "02:30", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "02:40", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "02:50", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "03:00", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "03:10", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "03:20", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "03:30", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "03:40", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "03:50", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "04:00", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "04:10", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "04:20", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "04:30", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "04:40", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "04:50", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "05:00", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "05:10", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "05:20", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "05:30", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "05:40", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "05:50", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "06:00", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "06:10", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "06:20", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "06:30", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "06:40", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "06:50", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "07:00", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "07:10", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "07:20", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "07:30", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "07:40", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "07:50", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "08:00", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "08:10", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "08:20", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "08:30", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "08:40", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "08:50", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "09:00", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "09:10", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "09:20", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "09:30", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "09:40", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "09:50", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "10:00", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "10:10", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "10:20", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "10:30", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "10:40", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "10:50", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "11:00", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "11:10", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "11:20", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "11:30", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "11:40", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "11:50", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "12:00", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "12:10", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "12:20", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "12:30", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "12:40", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "12:50", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "13:00", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "13:10", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "13:20", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "13:30", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "13:40", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "13:50", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "14:00", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "14:10", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "14:20", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "14:30", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "14:40", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "14:50", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "15:00", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "15:10", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "15:20", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "15:30", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "15:40", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "15:50", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "16:00", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "16:10", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "16:20", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "16:30", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "16:40", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "16:50", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "17:00", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "17:10", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "17:20", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "17:30", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "17:40", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "17:50", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "18:00", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "18:10", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "18:20", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "18:30", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "18:40", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "18:50", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "19:00", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "19:10", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "19:20", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "19:30", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "19:40", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "19:50", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "20:00", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "20:10", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "20:20", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "20:30", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "20:40", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "20:50", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "21:00", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "21:10", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "21:20", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "21:30", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "21:40", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "21:50", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "22:00", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "22:10", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
  { utcTime: "22:20", label: "LA Downtown → LAX", pickupLat: 34.0522, pickupLng: -118.2437, dropoffLat: 33.9425, dropoffLng: -118.4081 },
  { utcTime: "22:30", label: "Boston Common → Logan", pickupLat: 42.3554, pickupLng: -71.0656, dropoffLat: 42.3656, dropoffLng: -71.0096 },
  { utcTime: "22:40", label: "Seattle Pike Place → Sea-Tac", pickupLat: 47.6097, pickupLng: -122.3422, dropoffLat: 47.4502, dropoffLng: -122.3088 },
  { utcTime: "22:50", label: "Austin Capitol → AUS Airport", pickupLat: 30.2747, pickupLng: -97.7404, dropoffLat: 30.1975, dropoffLng: -97.6664 },
  { utcTime: "23:00", label: "Miami Beach → Downtown", pickupLat: 25.7907, pickupLng: -80.13, dropoffLat: 25.7743, dropoffLng: -80.1937 },
  { utcTime: "23:10", label: "DC Union Station → Reagan DCA", pickupLat: 38.8972, pickupLng: -77.0064, dropoffLat: 38.8512, dropoffLng: -77.0402 },
  { utcTime: "23:20", label: "Denver Downtown → DIA", pickupLat: 39.7392, pickupLng: -104.9903, dropoffLat: 39.8561, dropoffLng: -104.6737 },
  { utcTime: "23:30", label: "NYC Midtown → JFK", pickupLat: 40.7549, pickupLng: -73.984, dropoffLat: 40.6413, dropoffLng: -73.7781 },
  { utcTime: "23:40", label: "SF Union Square → SFO", pickupLat: 37.788, pickupLng: -122.4075, dropoffLat: 37.6213, dropoffLng: -122.379 },
  { utcTime: "23:50", label: "Chicago Millennium Park → ORD", pickupLat: 41.8827, pickupLng: -87.6233, dropoffLat: 41.9742, dropoffLng: -87.9073 },
];
const ALARM_NAME = "uber-trip-scheduler";
const LOGIN_CHECK_ALARM = "uber-login-check";
const TOTAL_SLOTS = TRIPS.length;

// ── Helpers ──
function getUTCDayStart(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Parse "HH:MM" → minutes since midnight
function parseUTCTime(utcTimeStr) {
  const [h, m] = utcTimeStr.split(":").map(Number);
  return h * 60 + m;
}

// Get the absolute timestamp for a trip's utcTime on a given day
function getTripTimestamp(tripIndex, dayStart) {
  const mins = parseUTCTime(TRIPS[tripIndex].utcTime);
  return dayStart + mins * 60 * 1000;
}

// Find the index of the first trip whose utcTime is strictly after now
function getNextTripIndex(now, dayStart) {
  for (let i = 0; i < TRIPS.length; i++) {
    if (getTripTimestamp(i, dayStart) > now) return i;
  }
  return TRIPS.length; // all trips are in the past
}

// Find the current trip index (last trip whose time <= now)
function getCurrentTripIndex(now, dayStart) {
  let last = -1;
  for (let i = 0; i < TRIPS.length; i++) {
    if (getTripTimestamp(i, dayStart) <= now) last = i;
  }
  return last;
}

// ── Listen for messages ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_STATE") {
    chrome.storage.local.get(["tripState"], (data) => {
      sendResponse(data.tripState || null);
    });
    return true;
  }

  if (msg.type === "GET_TRIP_SCHEDULE") {
    sendResponse(TRIPS.map(t => ({ utcTime: t.utcTime, label: t.label })));
    return;
  }

  if (msg.type === "CHECK_LOGIN_NOW") {
    checkUberLogin();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "UBER_PRODUCTS_CAPTURED") {
    handleProductsCapture(msg.data);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "UBER_REDIRECT_DETECTED") {
    console.warn("⚠ Content script detected redirect to:", msg.url);
    chrome.storage.local.get(["tripState"], async (data) => {
      const state = data.tripState;
      if (state && state.running && !state.capturedForCurrent) {
        await handleNotLoggedIn(state);
      }
    });
    sendResponse({ ok: true });
    return;
  }
});

// ── Alarm handler ──
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    onSlotAlarm();
  }
  if (alarm.name === LOGIN_CHECK_ALARM) {
    checkUberLogin();
  }
});

// ── Update badge on extension icon ──
function updateBadge(state) {
  if (!state) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (state.loginRequired) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c53030" });
  } else {
    const done = state.tripStatuses.filter(s => s === "success").length;
    const eligible = state.tripStatuses.filter(s => s !== "skipped").length;
    if (state.running) {
      chrome.action.setBadgeText({ text: `${done}/${eligible}` });
      chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
    } else {
      chrome.action.setBadgeText({ text: `${done}/${eligible}` });
      chrome.action.setBadgeBackgroundColor({ color: "#276749" });
    }
  }
}

// ── Check if user is logged into Uber ──
async function checkUberLogin() {
  try {
    const sid = await chrome.cookies.get({ url: "https://m.uber.com", name: "sid" });
    const hasSession = sid !== null;
    console.log(`🔐 Login check: sid cookie ${hasSession ? "FOUND" : "NOT FOUND"}`);

    const stored = await chrome.storage.local.get(["tripState"]);
    const state = stored.tripState;

    if (!hasSession) {
      await handleNotLoggedIn(state);
    } else {
      if (!state) {
        startSearch();
      } else if (state.loginRequired) {
        // Resume — skip to the next exact :X0:00 mark
        const now = Date.now();
        if (now >= state.endTime) {
          markDayComplete(state);
          return;
        }
        const nextSlot = getNextTripIndex(now, state.dayStart);
        // Mark all missed slots as skipped
        for (let i = (state.currentSlot || 0); i < nextSlot && i < TOTAL_SLOTS; i++) {
          if (state.tripStatuses[i] === "pending") state.tripStatuses[i] = "skipped";
        }
        state.loginRequired = false;
        state.running = true;
        state.currentSlot = nextSlot > 0 ? nextSlot - 1 : 0;
        state.capturedForCurrent = true; // nothing to capture for skipped slot
        await chrome.storage.local.set({ tripState: state });
        updateBadge(state);
        if (nextSlot >= TOTAL_SLOTS) {
          markDayComplete(state);
        } else {
          const nextTime = getTripTimestamp(nextSlot, state.dayStart);
          const wakeTime = nextTime - EARLY_WAKE_SEC * 1000;
          chrome.alarms.create(ALARM_NAME, { when: wakeTime });
          console.log(`✅ Login detected — next trip at ${TRIPS[nextSlot].utcTime} — fires at ${new Date(nextTime).toISOString()}`);
        }
      } else if (state.running) {
        // Already running — re-create alarm in case Chrome restarted
        scheduleNextSlot(state);
      }
    }
  } catch (err) {
    console.error("Login check error:", err);
  }
}

// ── Shared handler for "not logged in" detection ──
async function handleNotLoggedIn(state) {
  if (!state) {
    state = (await chrome.storage.local.get(["tripState"])).tripState;
  }

  if (!state) {
    // First launch while logged out — create initial state
    const now = Date.now();
    const dayStart = getUTCDayStart(now);
    const currentSlot = getCurrentTripIndex(now, dayStart);
    const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
    for (let i = 0; i <= currentSlot && i < TOTAL_SLOTS; i++) tripStatuses[i] = "skipped";

    state = {
      running: false,
      dayStart,
      endTime: dayStart + 24 * 60 * 60 * 1000,
      currentSlot,
      totalSlots: TOTAL_SLOTS,
      results: [],
      capturedForCurrent: false,
      tripStatuses,
      loginRequired: true,
      startTime: now,
    };
    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (state.running) {
    state.running = false;
    state.loginRequired = true;
    chrome.alarms.clear(ALARM_NAME);
    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (!state.loginRequired) {
    state.loginRequired = true;
    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
    sendLoginNotification();
  }
}

// ── Notify user that login is required ──
function sendLoginNotification() {
  console.warn("⚠ Not logged in — opening login-required page");
  const loginPageUrl = chrome.runtime.getURL("login-required.html");
  chrome.tabs.query({ url: loginPageUrl }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: loginPageUrl, active: true });
    }
  });
}

// ── Start the search schedule ──
async function startSearch() {
  const now = Date.now();
  const dayStart = getUTCDayStart(now);
  const endTime = dayStart + 24 * 60 * 60 * 1000;
  const nextSlot = getNextTripIndex(now, dayStart);
  console.log(`▶ Starting schedule: next trip is #${nextSlot} (${nextSlot < TOTAL_SLOTS ? TRIPS[nextSlot].utcTime : "none"}), ends at ${new Date(endTime).toISOString()}`);

  const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
  for (let i = 0; i < nextSlot; i++) tripStatuses[i] = "skipped";

  const state = {
    running: true,
    dayStart,
    endTime,
    currentSlot: nextSlot > 0 ? nextSlot - 1 : 0, // will be updated when next alarm fires
    totalSlots: TOTAL_SLOTS,
    results: [],
    capturedForCurrent: true, // nothing to capture for skipped slot
    tripStatuses,
    loginRequired: false,
    startTime: now,
  };

  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);

  if (nextSlot >= TOTAL_SLOTS) {
    markDayComplete(state);
  } else {
    // Schedule alarm 30s early; onSlotAlarm will busy-wait for exact :00
    const nextTime = getTripTimestamp(nextSlot, dayStart);
    const wakeTime = nextTime - EARLY_WAKE_SEC * 1000;
    chrome.alarms.create(ALARM_NAME, { when: wakeTime });
    console.log(`⏰ First trip: ${TRIPS[nextSlot].utcTime} — fires at ${new Date(nextTime).toISOString()}`);
  }
}

// ── Schedule alarm for the next 10-minute slot ──
// Alarm fires 30s early; waitForExactMark() busy-waits until :X0:00
const EARLY_WAKE_SEC = 30;

function scheduleNextSlot(state) {
  const nextSlot = state.currentSlot + 1;
  if (nextSlot >= TOTAL_SLOTS) {
    chrome.alarms.create(ALARM_NAME, { when: state.endTime + 1000 });
    console.log(`⏰ Final alarm at ${new Date(state.endTime + 1000).toISOString()}`);
    return;
  }
  const nextTime = getTripTimestamp(nextSlot, state.dayStart);
  // Wake up 30s early so we can busy-wait for exact :00
  const wakeTime = nextTime - EARLY_WAKE_SEC * 1000;
  chrome.alarms.create(ALARM_NAME, { when: wakeTime });
  console.log(`⏰ Next: ${TRIPS[nextSlot].utcTime} — fires at ${new Date(nextTime).toISOString()}`);
}

// ── Wait until an exact timestamp, then call callback ──
function waitForExactMark(targetTime, callback) {
  function poll() {
    const remaining = targetTime - Date.now();
    if (remaining <= 0) {
      callback();
      return;
    }
    // Use shorter intervals as we get closer
    const delay = remaining > 2000 ? 1000 : remaining > 200 ? 50 : 5;
    setTimeout(poll, delay);
  }
  poll();
}

// ── Slot alarm fired (30s early) — wait for exact :00 then run ──
// Guard: track which slot we're already waiting for to prevent duplicate fires
let _pendingSlot = -1;

async function onSlotAlarm() {
  try {
    const data = await chrome.storage.local.get(["tripState"]);
    const state = data.tripState;
    if (!state || !state.running) return;

    // Mark previous trip if not captured
    if (!state.capturedForCurrent && state.tripStatuses[state.currentSlot] === "searching") {
      state.tripStatuses[state.currentSlot] = "no_data";
      try {
        const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
        if (tabs.length > 0 && !tabs[0].url.includes("product-selection")) {
          console.warn("⚠ Tab redirected — login required");
          await handleNotLoggedIn(state);
          return;
        }
      } catch (e) {}
    }

    // Check if day is over
    if (Date.now() >= state.endTime) {
      markDayComplete(state);
      return;
    }

    // Figure out which slot we're waking up for
    const nextSlot = state.currentSlot + 1;
    if (nextSlot >= TOTAL_SLOTS) {
      markDayComplete(state);
      return;
    }

    // Deduplicate: if we're already waiting for this slot, skip
    if (_pendingSlot === nextSlot) {
      return;
    }
    _pendingSlot = nextSlot;

    const targetTime = getTripTimestamp(nextSlot, state.dayStart);

    // Mark any slots we missed between last and this one
    for (let i = state.currentSlot + 1; i < nextSlot; i++) {
      if (state.tripStatuses[i] === "pending") state.tripStatuses[i] = "skipped";
    }

    // Busy-wait until the exact :X0:00 mark
    console.log(`⏳ Waiting for exact ${TRIPS[nextSlot].utcTime} UTC (${targetTime - Date.now()}ms remaining)`);
    waitForExactMark(targetTime, async () => {
      try {
        // Re-read state to avoid stale data
        const fresh = await chrome.storage.local.get(["tripState"]);
        const s = fresh.tripState;
        if (!s || !s.running) { _pendingSlot = -1; return; }
        // Double-check we haven't already advanced past this slot
        if (s.currentSlot >= nextSlot) { _pendingSlot = -1; return; }

        console.log(`🎯 Firing trip #${nextSlot} (${TRIPS[nextSlot].utcTime}) at ${new Date().toISOString()}`);
        s.currentSlot = nextSlot;
        s.capturedForCurrent = false;
        await chrome.storage.local.set({ tripState: s });
        updateBadge(s);
        _pendingSlot = -1;
        runTrip(s);
        scheduleNextSlot(s);
      } catch (err) {
        _pendingSlot = -1;
        console.error("onSlotAlarm callback error:", err);
      }
    });
  } catch (err) {
    console.error("onSlotAlarm error:", err);
  }
}

// ── Mark the day as complete ──
async function markDayComplete(state) {
  state.running = false;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (state.tripStatuses[i] === "pending" || state.tripStatuses[i] === "searching") {
      state.tripStatuses[i] = "skipped";
    }
  }
  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
  chrome.alarms.clear(ALARM_NAME);
  const successCount = state.tripStatuses.filter(s => s === "success").length;
  const errorCount = state.tripStatuses.filter(s => s === "no_data" || s === "no_prices").length;
  const skippedCount = state.tripStatuses.filter(s => s === "skipped").length;
  console.log(`✅ Day complete: ${successCount} succeeded, ${errorCount} errors, ${skippedCount} skipped, ${state.results.length} CSV rows`);
}

// ── Navigate to the Uber URL for the current slot's trip ──
const CAPTURE_TIMEOUT_MS = 120_000; // 2 minutes — mark no_data if nothing captured

async function runTrip(state) {
  const slot = state.currentSlot;
  const trip = TRIPS[slot];
  console.log(`🚗 Trip #${slot} (${trip.utcTime} UTC): ${trip.label}`);

  state.tripStatuses[slot] = "searching";
  await chrome.storage.local.set({ tripState: state });

  const pickupObj = { latitude: trip.pickupLat, longitude: trip.pickupLng, addressLine1: "Pickup" };
  const dropoffObj = { latitude: trip.dropoffLat, longitude: trip.dropoffLng, addressLine1: "Dropoff" };

  const url =
    `https://m.uber.com/go/product-selection?action=setPickup` +
    `&pickup=${encodeURIComponent(JSON.stringify(pickupObj))}` +
    `&drop%5B0%5D=${encodeURIComponent(JSON.stringify(dropoffObj))}`;

  try {
    const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url });
    } else {
      await chrome.windows.create({
        url,
        focused: false,
        state: "minimized",
      });
    }
  } catch (err) {
    console.error("runTrip error:", err);
  }

  // Per-trip timeout: if no data captured within 2 min, mark as no_data
  setTimeout(async () => {
    try {
      const stored = await chrome.storage.local.get(["tripState"]);
      const s = stored.tripState;
      if (!s) return;
      if (s.currentSlot === slot && !s.capturedForCurrent && s.tripStatuses[slot] === "searching") {
        console.warn(`⏰ Capture timeout for trip #${slot} (${trip.utcTime} UTC) — marking no_data`);
        s.tripStatuses[slot] = "no_data";
        await chrome.storage.local.set({ tripState: s });
        updateBadge(s);
      }
    } catch (e) {
      console.error("Capture timeout error:", e);
    }
  }, CAPTURE_TIMEOUT_MS);
}

// ── Handle captured products data from content script ──
async function handleProductsCapture(productsData) {
  const stored = await chrome.storage.local.get(["tripState"]);
  const state = stored.tripState;
  if (!state || !state.running) return;
  if (state.capturedForCurrent) return;

  state.capturedForCurrent = true;

  const trip = TRIPS[state.currentSlot];
  const tiers = productsData?.data?.products?.tiers || [];
  let count = 0;
  let hasValidFare = false;

  for (const tier of tiers) {
    for (const product of tier.products || []) {
      for (const fare of product.fares || []) {
        let meta = {};
        try { meta = JSON.parse(fare.meta); } catch (_) {}

        const uf = meta?.upfrontFare || {};
        const dynFare = uf?.dynamicFareInfo || {};
        const sig = uf?.signature || {};

        if (fare.fare && fare.fare !== "" && fare.fareAmountE5 > 0) {
          hasValidFare = true;
        }

        state.results.push({
          slot: state.currentSlot,
          scheduledUTC: trip.utcTime,
          tripLabel: trip.label,
          searchTime: new Date().toISOString(),
          tier: tier.title,
          productName: product.displayName,
          productType: product.productClassificationTypeName,
          estimatedTripTime: product.estimatedTripTime ?? "",
          etaStringShort: product.etaStringShort ?? "",
          fare: fare.fare ?? "",
          preAdjustmentValue: fare.preAdjustmentValue ?? "",
          discountPrimary: fare.discountPrimary ?? "",
          discountedFare: uf.discountedFare ?? "",
          hasBenefitsOnFare: product.hasBenefitsOnFare ?? "",
          hasPromo: fare.hasPromo ?? "",
          hasRidePass: fare.hasRidePass ?? "",
          fareEstimateInfo: JSON.stringify(meta.fareEstimateInfo ?? ""),
          ezpzFareBreakdown: JSON.stringify(uf.ezpzFareBreakdown ?? ""),
          multiplier: dynFare.multiplier ?? "",
          surgeSuppressionThreshold: dynFare.surgeSuppressionThreshold ?? "",
          requestLocationLat: meta?.pricingParams?.requestLocation?.latitude ?? "",
          requestLocationLng: meta?.pricingParams?.requestLocation?.longitude ?? "",
          originLat: uf.originLat ?? "",
          originLng: uf.originLng ?? "",
          destinationLat: uf.destinationLat ?? "",
          destinationLng: uf.destinationLng ?? "",
          capacity: uf.capacity ?? "",
          issuedAt: sig.issuedAt ?? "",
          isSobriety: dynFare.isSobriety ?? "",
        });
        count++;
      }
    }
  }

  if (hasValidFare) {
    state.tripStatuses[state.currentSlot] = "success";
    console.log(`💾 Slot ${state.currentSlot} captured: ${count} products, ${state.results.length} total rows`);
  } else {
    state.tripStatuses[state.currentSlot] = "no_prices";
    state.loginRequired = true;
    state.running = false;
    state.results.splice(state.results.length - count, count);
    chrome.alarms.clear(ALARM_NAME);
    console.warn(`⚠ Slot ${state.currentSlot}: no prices — not logged in`);
    sendLoginNotification();
  }

  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
}

// ── Auto-start on install and on every Chrome launch ──
chrome.runtime.onInstalled.addListener(() => {
  console.log("Uber Personalized Prices Aggregator installed");
  chrome.storage.local.remove(["tripState"], () => {
    console.log("🗑 Cleared old tripState");
    chrome.alarms.create(LOGIN_CHECK_ALARM, { periodInMinutes: 0.5 });
    checkUberLogin();
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started");
  chrome.alarms.create(LOGIN_CHECK_ALARM, { periodInMinutes: 0.5 });
  checkUberLogin();
});
