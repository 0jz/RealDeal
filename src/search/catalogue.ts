import type { Category, Product } from "./types"

// Canonical electronics catalogue. Prices are rough new prices in RSD and only
// serve as a baseline before real listings come in; scores rank devices within
// a category (higher = better device).

export const CATALOGUE: Product[] = [
	// Phones
	{ id: "iphone-13", brand: "Apple", model: "iPhone 13", category: "phone", year: 2021, score: 58, msrp: 62000, storages: [128, 256, 512], aliases: ["ajfon 13"] },
	{ id: "iphone-14", brand: "Apple", model: "iPhone 14", category: "phone", year: 2022, score: 63, msrp: 72000, storages: [128, 256, 512], aliases: ["ajfon 14"] },
	{ id: "iphone-15", brand: "Apple", model: "iPhone 15", category: "phone", year: 2023, score: 70, msrp: 85000, storages: [128, 256, 512], aliases: ["ajfon 15"] },
	{ id: "iphone-15-pro", brand: "Apple", model: "iPhone 15 Pro", category: "phone", year: 2023, score: 78, msrp: 115000, storages: [128, 256, 512, 1024], aliases: ["ajfon 15 pro"] },
	{ id: "iphone-15-pro-max", brand: "Apple", model: "iPhone 15 Pro Max", category: "phone", year: 2023, score: 81, msrp: 135000, storages: [256, 512, 1024], aliases: ["ajfon 15 pro max", "15 pm"] },
	{ id: "iphone-16", brand: "Apple", model: "iPhone 16", category: "phone", year: 2024, score: 76, msrp: 100000, storages: [128, 256, 512], aliases: ["ajfon 16"] },
	{ id: "iphone-16-pro", brand: "Apple", model: "iPhone 16 Pro", category: "phone", year: 2024, score: 85, msrp: 140000, storages: [128, 256, 512, 1024], aliases: ["ajfon 16 pro"] },
	{ id: "iphone-17", brand: "Apple", model: "iPhone 17", category: "phone", year: 2025, score: 84, msrp: 115000, storages: [256, 512], aliases: ["ajfon 17"] },
	{ id: "galaxy-s23", brand: "Samsung", model: "Galaxy S23", category: "phone", year: 2023, score: 66, msrp: 75000, storages: [128, 256], aliases: ["s23"] },
	{ id: "galaxy-s24", brand: "Samsung", model: "Galaxy S24", category: "phone", year: 2024, score: 74, msrp: 90000, storages: [128, 256, 512], aliases: ["s24"] },
	{ id: "galaxy-s24-ultra", brand: "Samsung", model: "Galaxy S24 Ultra", category: "phone", year: 2024, score: 84, msrp: 145000, storages: [256, 512, 1024], aliases: ["s24 ultra", "s24u"] },
	{ id: "galaxy-s25", brand: "Samsung", model: "Galaxy S25", category: "phone", year: 2025, score: 80, msrp: 105000, storages: [128, 256, 512], aliases: ["s25"] },
	{ id: "galaxy-a55", brand: "Samsung", model: "Galaxy A55", category: "phone", year: 2024, score: 52, msrp: 45000, storages: [128, 256], aliases: ["a55"] },
	{ id: "galaxy-a35", brand: "Samsung", model: "Galaxy A35", category: "phone", year: 2024, score: 45, msrp: 36000, storages: [128, 256], aliases: ["a35"] },
	{ id: "redmi-note-13-pro", brand: "Xiaomi", model: "Redmi Note 13 Pro", category: "phone", year: 2024, score: 48, msrp: 38000, storages: [256, 512], aliases: ["note 13 pro", "rn13 pro"] },
	{ id: "xiaomi-14", brand: "Xiaomi", model: "Xiaomi 14", category: "phone", year: 2024, score: 75, msrp: 95000, storages: [256, 512], aliases: ["mi 14", "ksiaomi 14", "sjaomi 14"] },
	{ id: "pixel-8", brand: "Google", model: "Pixel 8", category: "phone", year: 2023, score: 67, msrp: 70000, storages: [128, 256], aliases: ["piksel 8"] },
	{ id: "pixel-9", brand: "Google", model: "Pixel 9", category: "phone", year: 2024, score: 75, msrp: 90000, storages: [128, 256], aliases: ["piksel 9"] },

	// Consoles
	{ id: "ps5", brand: "Sony", model: "PlayStation 5", category: "console", year: 2020, score: 70, msrp: 60000, aliases: ["ps5", "plejstejsn 5", "sony 5", "ps 5 disk"] },
	{ id: "ps5-slim-digital", brand: "Sony", model: "PlayStation 5 Slim Digital", category: "console", year: 2023, score: 72, msrp: 52000, aliases: ["ps5 slim digital", "ps5 slim dig"] },
	{ id: "ps5-pro", brand: "Sony", model: "PlayStation 5 Pro", category: "console", year: 2024, score: 85, msrp: 95000, aliases: ["ps5 pro"] },
	{ id: "xbox-series-x", brand: "Microsoft", model: "Xbox Series X", category: "console", year: 2020, score: 72, msrp: 62000, aliases: ["series x", "iksboks series x"] },
	{ id: "xbox-series-s", brand: "Microsoft", model: "Xbox Series S", category: "console", year: 2020, score: 55, msrp: 35000, aliases: ["series s"] },
	{ id: "switch-oled", brand: "Nintendo", model: "Switch OLED", category: "console", year: 2021, score: 58, msrp: 40000, aliases: ["nintendo svic oled", "switch oled"] },
	{ id: "switch-2", brand: "Nintendo", model: "Switch 2", category: "console", year: 2025, score: 78, msrp: 60000, aliases: ["svic 2", "nintendo switch 2"] },

	// Laptops
	{ id: "macbook-air-m2", brand: "Apple", model: "MacBook Air M2", category: "laptop", year: 2022, score: 68, msrp: 120000, storages: [256, 512], aliases: ["mekbuk air m2", "mba m2"] },
	{ id: "macbook-air-m3", brand: "Apple", model: "MacBook Air M3", category: "laptop", year: 2024, score: 76, msrp: 145000, storages: [256, 512], aliases: ["mekbuk air m3", "mba m3"] },
	{ id: "macbook-pro-14-m3", brand: "Apple", model: "MacBook Pro 14 M3", category: "laptop", year: 2023, score: 85, msrp: 210000, storages: [512, 1024], aliases: ["mbp 14 m3", "mekbuk pro 14"] },
	{ id: "ideapad-slim-5", brand: "Lenovo", model: "IdeaPad Slim 5", category: "laptop", year: 2023, score: 55, msrp: 80000, storages: [512, 1024], aliases: ["ideapad 5"] },
	{ id: "asus-tuf-a15", brand: "ASUS", model: "TUF Gaming A15", category: "laptop", year: 2023, score: 62, msrp: 105000, storages: [512, 1024], aliases: ["tuf a15", "asus tuf"] },
	{ id: "hp-victus-15", brand: "HP", model: "Victus 15", category: "laptop", year: 2023, score: 57, msrp: 90000, storages: [512], aliases: ["viktus 15"] },

	// Tablets
	{ id: "ipad-10", brand: "Apple", model: "iPad 10", category: "tablet", year: 2022, score: 55, msrp: 50000, storages: [64, 256], aliases: ["ajped 10", "ipad 10th gen"] },
	{ id: "ipad-air-m2", brand: "Apple", model: "iPad Air M2", category: "tablet", year: 2024, score: 75, msrp: 85000, storages: [128, 256, 512], aliases: ["ajped air m2"] },
	{ id: "galaxy-tab-s9-fe", brand: "Samsung", model: "Galaxy Tab S9 FE", category: "tablet", year: 2023, score: 52, msrp: 45000, storages: [128, 256], aliases: ["tab s9 fe"] },

	// Headphones
	{ id: "airpods-pro-2", brand: "Apple", model: "AirPods Pro 2", category: "headphones", year: 2022, score: 75, msrp: 30000, aliases: ["erpods pro 2", "airpods pro 2nd gen"] },
	{ id: "sony-wh-1000xm5", brand: "Sony", model: "WH-1000XM5", category: "headphones", year: 2022, score: 82, msrp: 40000, aliases: ["xm5", "1000xm5"] },
	{ id: "sony-wh-1000xm4", brand: "Sony", model: "WH-1000XM4", category: "headphones", year: 2020, score: 72, msrp: 30000, aliases: ["xm4", "1000xm4"] },
	{ id: "galaxy-buds2-pro", brand: "Samsung", model: "Galaxy Buds2 Pro", category: "headphones", year: 2022, score: 62, msrp: 20000, aliases: ["buds 2 pro"] },

	// TVs
	{ id: "samsung-55-cu7172", brand: "Samsung", model: "55\" Crystal UHD CU7172", category: "tv", year: 2023, score: 52, msrp: 55000, aliases: ["55cu7172", "ue55cu7172"] },
	{ id: "lg-oled55c3", brand: "LG", model: "OLED55C3", category: "tv", year: 2023, score: 85, msrp: 150000, aliases: ["oled55c3", "lg c3 55"] },

	// GPUs
	{ id: "rtx-4060", brand: "NVIDIA", model: "GeForce RTX 4060", category: "gpu", year: 2023, score: 58, msrp: 38000, aliases: ["rtx4060", "4060"] },
	{ id: "rtx-4070-super", brand: "NVIDIA", model: "GeForce RTX 4070 Super", category: "gpu", year: 2024, score: 76, msrp: 75000, aliases: ["4070 super", "4070s"] },
	{ id: "rx-7800-xt", brand: "AMD", model: "Radeon RX 7800 XT", category: "gpu", year: 2023, score: 72, msrp: 62000, aliases: ["7800xt", "rx7800xt"] },

	// Watches
	{ id: "apple-watch-9", brand: "Apple", model: "Apple Watch Series 9", category: "watch", year: 2023, score: 70, msrp: 50000, aliases: ["ajvoc 9", "watch 9"] },
]

export const PRODUCTS = new Map(CATALOGUE.map((p) => [p.id, p]))

export const productName = (id: string) => {
	const p = PRODUCTS.get(id)
	return p ? (p.model.startsWith(p.brand) ? p.model : `${p.brand} ${p.model}`) : id
}

/** Words people use for a category, in Serbian and English. Normalized (lowercase, no diacritics). */
export const CATEGORY_WORDS: Record<Category, string[]> = {
	phone: ["telefon", "telefoni", "mobilni", "mobilni telefon", "smartphone", "phone"],
	laptop: ["laptop", "laptopovi", "notebook", "lap top", "ноутбук", "ноутбуки", "ноутбуков"],
	tablet: ["tablet", "tableti"],
	console: ["konzola", "konzole", "console"],
	tv: ["tv", "televizor", "televizori"],
	headphones: ["slusalice", "headphones", "earbuds"],
	gpu: ["graficka", "graficka karta", "gpu", "grafika"],
	watch: ["sat", "pametni sat", "smartwatch"],
}
