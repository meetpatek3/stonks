INSERT INTO "currency" ("code", "minor_units", "name")
VALUES
	('CAD', 2, 'Canadian Dollar'),
	('USD', 2, 'United States Dollar'),
	('EUR', 2, 'Euro'),
	('GBP', 2, 'Pound Sterling'),
	('JPY', 0, 'Yen'),
	('CHF', 2, 'Swiss Franc'),
	('AUD', 2, 'Australian Dollar')
ON CONFLICT DO NOTHING;
