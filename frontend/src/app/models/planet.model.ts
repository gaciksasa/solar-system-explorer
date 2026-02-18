export interface Planet {
  name: string;
  name_sr: string;
  radius: number;            // km
  distance_from_sun: number; // AU (semi-major axis)
  orbital_period: number;    // Earth days
  rotation_period: number;   // Earth days
  color: string;             // hex
  description: string;
  satellites: number;
  notable_satellites: string[];
  is_star: boolean;
  is_asteroid_belt?: boolean;
  is_oort_cloud?: boolean;
  // Keplerian orbital elements (J2000)
  eccentricity: number;    // 0 = circle
  inclination: number;     // degrees, relative to ecliptic
  ascending_node: number;  // degrees, longitude of ascending node (Ω)
}
