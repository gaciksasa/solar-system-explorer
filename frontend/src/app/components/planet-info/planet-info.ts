import { Component, Input, Output, EventEmitter } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Planet } from '../../models/planet.model';

@Component({
  selector: 'app-planet-info',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './planet-info.html',
  styleUrl: './planet-info.scss',
})
export class PlanetInfo {
  @Input() planet!: Planet;
  @Output() closed = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }

  formatPeriod(days: number): string {
    const absDays = Math.abs(days);
    if (absDays >= 365) {
      return `${(absDays / 365.25).toFixed(2)} god.`;
    }
    return `${absDays.toFixed(2)} dana`;
  }

  formatDistance(au: number): string {
    const km = au * 149_597_870;
    if (km >= 1_000_000) {
      return `${(km / 1_000_000).toFixed(2)} mil. km`;
    }
    return `${km.toFixed(0)} km`;
  }

  perihelion(p: Planet): string {
    return this.formatDistance(p.distance_from_sun * (1 - p.eccentricity));
  }

  aphelion(p: Planet): string {
    return this.formatDistance(p.distance_from_sun * (1 + p.eccentricity));
  }

  formatInclination(deg: number): string {
    return `${deg.toFixed(3)}°`;
  }
}
