import { Component, OnInit, inject, signal } from '@angular/core';
import { Planet } from './models/planet.model';
import { PlanetService } from './services/planet.service';
import { SolarSystem } from './components/solar-system/solar-system';
import { PlanetInfo } from './components/planet-info/planet-info';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SolarSystem, PlanetInfo],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private planetService = inject(PlanetService);

  planets = signal<Planet[]>([]);
  selectedPlanet = signal<Planet | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.planetService.getPlanets().subscribe({
      next: (planets) => {
        this.planets.set(planets);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(
          'Ne mogu da se povežem sa Go API-jem. Provjeri da li je backend pokrenut na http://localhost:8080'
        );
        this.loading.set(false);
      },
    });
  }

  onPlanetSelected(planet: Planet): void {
    this.selectedPlanet.set(planet);
  }

  onInfoClosed(): void {
    this.selectedPlanet.set(null);
  }
}
