package com.sekundo.pdfview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A PDF drawn with the system PdfRenderer; Android's WebView cannot show one. */
class AnviqPdfViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AnviqPdfView")

    View(AnviqPdfView::class) {
      Events("onLoadError")
      Prop("uri") { view: AnviqPdfView, uri: String -> view.load(uri) }
      OnViewDestroys { view: AnviqPdfView -> view.release() }
    }
  }
}
