package main

func backendLocale() string {
	settings, err := loadSettings()
	if err != nil {
		return "zh"
	}
	if settings.Language == "en" {
		return "en"
	}
	return "zh"
}

func localized(zh string, en string) string {
	if backendLocale() == "en" {
		return en
	}
	return zh
}
